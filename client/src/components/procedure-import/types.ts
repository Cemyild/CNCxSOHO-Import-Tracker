export interface AnalyzeDocumentResult {
  pdfFile: { objectKey: string; originalFilename: string; fileSize: number; fileType: string; pageCount: number };
  header: {
    shipper: string; package: number; kg: number; piece: number; awbNumber: string;
    customs: string; importDeclarationNumber: string; importDeclarationDate: string;
    usdTlRate: number; invoice_no: string; invoice_date: string; amount: number; currency: string;
  };
  taxes: { customsTax: number; additionalCustomsTax: number; kkdf: number; vat: number; stampTax: number };
  expenses: Array<{ category: string; amount: number; currency: string; invoiceNumber: string; invoiceDate: string; issuer: string; documentNumber: string; originalPage: number | null }>;
  serviceInvoices: Array<{ amount: number; currency: string; invoiceNumber: string; date: string; notes: string; originalPage: number | null }>;
  products: Array<{ style: string; unit_count: number; cost: number; total_value: number; tr_hs_code: string; hts_code: string }>;
  documents: Array<{ importDocumentType: string; originalPages: number[] }>;
}
