import { randomBytes } from "crypto";

/**
 * POS sync (Restaurant Bundle phase 2). A POS posts each bill to
 *   POST /api/v1/pos/<provider>/<posToken>
 * where posToken is one outlet's secret (Settings → POS sync). The bill
 * becomes a VISIT event (amount, customer phone/name) in that outlet, so
 * points, the rating request, segments and the ₹ report all follow.
 *
 * Petpooja: there is no self-serve CRM API; Petpooja's team configures a
 * webhook URL that receives each order. Payloads seen in the wild wrap the
 * same objects differently — { properties: {Restaurant, Customer, Order,
 * OrderItem} }, { orderinfo: { Customer, Order, … } }, { OrderInfo: … }, and
 * each member may sit in a `details` object — so the parser looks through
 * all of these, case-insensitively. Pure (no DB): test/pos.test.ts.
 */

export type PosBill = {
  restId: string | null;
  orderId: string;
  phone: string;
  name: string | null;
  amount: number;
  occurredAt: string | null;
  status: string | null;
  items: { name: string; qty: number; price: number }[];
};

export type PosParse = { ok: true; bill: PosBill } | { ok: false; reason: "IGNORED" | "INVALID"; error: string };

export const POS_PROVIDERS = ["petpooja", "generic"] as const;
export type PosProvider = (typeof POS_PROVIDERS)[number];

export function newPosToken() {
  return `pos_${randomBytes(18).toString("hex")}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Case-insensitive key lookup, unwrapping { details: {...} }. */
function pick(o: unknown, ...keys: string[]): unknown {
  if (!isObj(o)) return undefined;
  const map = new Map(Object.keys(o).map((k) => [k.toLowerCase().replace(/[_\s]/g, ""), k]));
  for (const k of keys) {
    const real = map.get(k.toLowerCase().replace(/[_\s]/g, ""));
    if (real !== undefined) {
      const v = o[real];
      return isObj(v) && isObj(v.details) ? v.details : v;
    }
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Indian mobile in any common form → "91XXXXXXXXXX". Numbers that already
 * carry another country code (11–15 digits not starting 0/91) are kept.
 */
export function normalizePhone(raw: unknown, defaultCountry = "91"): string | null {
  let d = str(raw).replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d) || defaultCountry !== "91" ? defaultCountry + d : null;
  if (d.length === 12 && d.startsWith("91")) return /^91[6-9]/.test(d) ? d : null;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** "2026-11-23 13:45:10" (IST, no zone) or ISO → ISO with offset. */
export function posTime(raw: unknown, offset = "+05:30"): string | null {
  const s = str(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) return `${s.replace(" ", "T")}${s.length === 16 ? ":00" : ""}${offset}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const CANCELLED = /cancel|reject|void|deleted|refund/i;

export function parsePetpooja(payload: unknown): PosParse {
  let root: unknown = payload;
  for (const k of ["properties", "orderinfo", "OrderInfo", "data"]) {
    const inner = pick(root, k);
    if (isObj(inner)) root = inner;
  }
  // { orderinfo: { OrderInfo: {...} } } nests twice.
  const again = pick(root, "OrderInfo");
  if (isObj(again)) root = again;

  const restaurant = pick(root, "Restaurant");
  const customer = pick(root, "Customer");
  const order = pick(root, "Order");
  if (!isObj(order)) return { ok: false, reason: "INVALID", error: "No Order in the payload" };

  const status = str(pick(order, "status", "order_status", "orderstatus")) || null;
  if (status && CANCELLED.test(status)) return { ok: false, reason: "IGNORED", error: `Order status "${status}"` };

  const orderId = str(pick(order, "orderID", "order_id", "id", "client_order_id", "bill_no", "billno"));
  if (!orderId) return { ok: false, reason: "INVALID", error: "No order id" };
  const phone = normalizePhone(pick(customer, "phone", "mobile", "phone_number", "contact"));
  if (!phone) return { ok: false, reason: "IGNORED", error: "No customer phone on this bill" };
  const amount = num(pick(order, "total", "grand_total", "order_total", "net_total", "amount"));
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: "INVALID", error: "No valid total" };

  const itemsRaw = pick(root, "OrderItem", "order_items", "items");
  const items = (Array.isArray(itemsRaw) ? itemsRaw : isObj(itemsRaw) ? [itemsRaw] : [])
    .map((it) => (isObj(it) && isObj(it.details) ? it.details : it))
    .filter(isObj)
    .map((it) => ({ name: str(pick(it, "name", "itemname", "item_name")), qty: num(pick(it, "quantity", "qty")) || 1, price: num(pick(it, "price", "final_price", "total")) || 0 }))
    .filter((it) => it.name);

  return {
    ok: true,
    bill: {
      restId: str(pick(restaurant, "restID", "res_id", "rest_id", "restaurant_id", "mapping_id")) || str(pick(root, "restID", "rest_id")) || null,
      orderId,
      phone,
      name: str(pick(customer, "name", "customer_name")) || null,
      amount: Math.round(amount * 100) / 100,
      occurredAt: posTime(pick(order, "created_on", "createdon", "order_date", "created_at", "date")),
      status,
      items,
    },
  };
}

/** Our own simple format for any other POS / cashier app. */
export function parseGeneric(payload: unknown): PosParse {
  if (!isObj(payload)) return { ok: false, reason: "INVALID", error: "Body must be a JSON object" };
  const orderId = str(payload.orderId ?? payload.billNo);
  if (!orderId) return { ok: false, reason: "INVALID", error: "orderId is required" };
  if (payload.status && CANCELLED.test(str(payload.status))) return { ok: false, reason: "IGNORED", error: "Cancelled" };
  const phone = normalizePhone(payload.phone);
  if (!phone) return { ok: false, reason: "IGNORED", error: "No customer phone" };
  const amount = num(payload.amount ?? payload.total);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, reason: "INVALID", error: "amount is required" };
  return {
    ok: true,
    bill: { restId: null, orderId, phone, name: str(payload.name) || null, amount, occurredAt: posTime(payload.occurredAt ?? payload.createdAt), status: null, items: [] },
  };
}

export function parsePos(provider: PosProvider, payload: unknown): PosParse {
  return provider === "petpooja" ? parsePetpooja(payload) : parseGeneric(payload);
}

/** The VISIT event the bill becomes (lib/ingest-events.ts). */
export function billToEvent(provider: PosProvider, bill: PosBill, locationId: string) {
  return {
    type: "VISIT" as const,
    phone: bill.phone,
    ...(bill.name ? { name: bill.name.slice(0, 100) } : {}),
    ...(bill.occurredAt && new Date(bill.occurredAt).getTime() <= Date.now() + 5 * 60_000 ? { occurredAt: bill.occurredAt } : {}),
    amount: bill.amount,
    externalId: `pos:${provider}:${bill.restId ?? "-"}:${bill.orderId}`.slice(0, 100),
    locationId,
  };
}
