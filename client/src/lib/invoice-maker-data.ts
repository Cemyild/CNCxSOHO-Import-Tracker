// Static data for the Invoice Maker form.
// Address blocks are copied verbatim from real invoices (TR00025 / TR00026),
// including line breaks (\r\n), trailing spaces and original spelling, so the
// exported Excel matches the originals exactly.

export type AddressEntity = {
  id: string;
  label: string;
  address: string;
};

export const SHIPPERS: AddressEntity[] = [
  {
    id: "alo-llc",
    label: "ALO, LLC",
    address: [
      "ALO, LLC",
      "9830 WILSHIRE BLVD, BEVERLY HILLS, CALIFORNIA 90212, ",
      "UNITED STATES OF AMERICA",
      "ATTN: JOSEPHINE PENNEY: C: 323.891.5313 ",
      "JOSEPHINE.PENNEY@ALOYOGA.COM",
    ].join("\r\n"),
  },
  {
    id: "alo-hk",
    label: "ALO HONG KONG LTD",
    address: [
      "ALO HONG KONG LTD",
      "6/F, THE ANNEX, CENTRAL PLAZA, 18 HARBOUR ROAD, HONG KONG",
      "ATTN: JOSEPHINE PENNEY: C: 323.891.5313 JOSEPHINE.PENNEY@ALOYOGA.COM ",
    ].join("\r\n"),
  },
];

export const IMPORTERS: AddressEntity[] = [
  {
    id: "soho",
    label: "SOHO PERAKENDE YATIRIM VE TICARET A.S.",
    address: [
      "SOHO PERAKENDE YATIRIM VE TICARET ANONIM SIRKETI",
      "TEKFEN TOWER, BUILDING NUMBER: NO:209/16, ESENTEPE MAH. BÜYÜKDERE CAD., POSTAL CODE: 34394, ŞIŞLI, ISTANBUL. TURKEY",
      "CONTACT : NILESH KAMBLE. EMAIL: N.KAMBLE@SOHOME.AE. MOBILE: +971 56 433 0965.VAT NO. 7721648087",
    ].join("\r\n"),
  },
];

export const DELIVERY_PLACES: AddressEntity[] = [
  {
    id: "ulustrans",
    label: "ULUSTRANS LOGISTICS",
    address: [
      "ULUSTRANS LOGISTICS",
      "ÖMERLI MAHALLESI, KAZAN SOKAK, 14. CADDE NO:22, ARNAVUTKÖY / İSTANBUL. POSTAL CODE: 34555. TURKEY. CONTACT PERSON: NILESH KAMBLE. EMAIL: N.KAMBLE@SOHOME.AE.  // SELÇUK KÖKSAL, ",
      "+90 546 456 28 03 / SELCUK.KOKSAL@ULUSTRANS.COM",
    ].join("\r\n"),
  },
];

export const DEFAULT_PORTS_OF_LOADING = ["LOS ANGELES, USA"];

export const DEFAULT_FINAL_DESTINATIONS = ["ISTANBUL, TURKEY"];

export const DEFAULT_PAYMENT_TERMS = ["AT 30 DAYS"];

export const SHIPMENT_MODES = ["AIR", "SEA", "LAND"];

// Values are written to the Excel cell as-is. "EX-WORKS" matches the
// spelling used in the original invoices.
export const INCOTERMS: { value: string; label: string }[] = [
  { value: "EX-WORKS", label: "EX-WORKS (EXW)" },
  { value: "FCA", label: "FCA — Free Carrier" },
  { value: "CPT", label: "CPT — Carriage Paid To" },
  { value: "CIP", label: "CIP — Carriage and Insurance Paid To" },
  { value: "DAP", label: "DAP — Delivered At Place" },
  { value: "DPU", label: "DPU — Delivered at Place Unloaded" },
  { value: "DDP", label: "DDP — Delivered Duty Paid" },
  { value: "FAS", label: "FAS — Free Alongside Ship" },
  { value: "FOB", label: "FOB — Free On Board" },
  { value: "CFR", label: "CFR — Cost and Freight" },
  { value: "CIF", label: "CIF — Cost, Insurance and Freight" },
];

export const GOODS_DESCRIPTIONS = [
  "FOOTWEAR",
  "READY TO WEAR GARMENTS",
  "ACCESSORY",
];

export type InvoiceHeaderForm = {
  shipperId: string;
  invoiceNo: string;
  invoiceDate: Date | undefined;
  invoiceReference: string;
  poOrderNo: string;
  importerId: string;
  deliveryPlaceId: string;
  portOfLoading: string;
  finalDestination: string;
  paymentTerm: string;
  shipmentMode: string;
  shipmentTerm: string;
  whInvoiceRef: string;
  goodsDescriptions: string[];
  // Gross weight, MEAS/CBM and total pallets are derived from the pallet
  // rows; only the carton count has to be typed in manually.
  totalCartons: string;
};

export const EMPTY_INVOICE_HEADER: InvoiceHeaderForm = {
  shipperId: "",
  invoiceNo: "",
  invoiceDate: undefined,
  invoiceReference: "",
  poOrderNo: "",
  importerId: IMPORTERS[0].id,
  deliveryPlaceId: DELIVERY_PLACES[0].id,
  portOfLoading: DEFAULT_PORTS_OF_LOADING[0],
  finalDestination: DEFAULT_FINAL_DESTINATIONS[0],
  paymentTerm: DEFAULT_PAYMENT_TERMS[0],
  shipmentMode: "AIR",
  shipmentTerm: "EX-WORKS",
  whInvoiceRef: "",
  goodsDescriptions: [],
  totalCartons: "",
};

// One row of the Packing List pallet table. Dimensions are in cm; the
// exported "Pallet Dimension" cell is rendered as "LxWxH".
export type PalletRow = {
  id: string;
  length: string;
  width: string;
  height: string;
  qty: string;
  grossWt: string;
};

export type PalletDraft = Omit<PalletRow, "id">;

export const EMPTY_PALLET_DRAFT: PalletDraft = {
  length: "",
  width: "",
  height: "",
  qty: "1",
  grossWt: "",
};

export function palletCbm(p: { length: string; width: string; height: string; qty: string }): number {
  const l = Number(p.length) || 0;
  const w = Number(p.width) || 0;
  const h = Number(p.height) || 0;
  const q = Number(p.qty) || 0;
  return (l * w * h * q) / 1_000_000;
}
