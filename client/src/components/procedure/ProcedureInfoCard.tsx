import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/utils/formatters";

type DateLike = string | Date | null | undefined;

// The procedure fields the card displays. Loosely typed so both the local
// Procedure interface (procedure-details) and the schema type (expense-details)
// can be passed in.
export interface ProcedureInfo {
  reference: string;
  shipper?: string | null;
  invoice_no?: string | null;
  invoice_date?: DateLike;
  amount?: string | number | null;
  currency?: string | null;
  package?: string | null;
  kg?: string | number | null;
  piece?: string | number | null;
  arrival_date?: DateLike;
  awb_number?: string | null;
  carrier?: string | null;
  customs?: string | null;
  import_dec_number?: string | null;
  import_dec_date?: DateLike;
  customs_file_no?: string | null;
  shipment_status?: string | null;
  payment_status?: string | null;
  document_status?: string | null;
}

// Company logo based on procedure reference
const getCompanyLogo = (reference: string) => {
  if (reference.startsWith('CNCALO')) {
    return '/assets/logos/alo-logo.png';
  } else if (reference.startsWith('CNCAMIRI')) {
    return '/assets/logos/amiri-logo.png';
  } else {
    return '/assets/logos/soho-logo.png';
  }
};

// Format date as DD.MM.YYYY using UTC components to avoid timezone shifts
const formatDateWithFallback = (dateValue: DateLike, fallback: string = "N/A") => {
  if (!dateValue) return fallback;
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return fallback;
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}.${month}.${year}`;
};

export function ProcedureInfoCard({ procedure }: { procedure: ProcedureInfo }) {
  const { t } = useTranslation();

  // Translate a known status enum value to its localized label.
  // Falls back to a title-cased version for any unmapped status.
  const statusLabel = (status: string) => {
    const key = `procedurePages.statusLabels.${status}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return status.split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const formatStatusBadge = (status: string | null | undefined) => {
    if (!status) {
      return (
        <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400">
          {t("procedurePages.details.statusUnknown")}
        </Badge>
      );
    }

    let badgeClass = "";

    // Shipment status colors
    if (["created", "import_started", "tareks_application", "tax_calc_insurance_sent", "transit_started", "transit_in_process"].includes(status)) {
      badgeClass = "bg-yellow-500 text-white";
    }
    else if (["arrived", "tareks_approved", "import_finished", "delivered"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Payment status colors
    else if (["taxletter_sent", "final_balance_letter_sent"].includes(status)) {
      badgeClass = "bg-yellow-500 text-white";
    }
    else if (["waiting_adv_payment"].includes(status)) {
      badgeClass = "bg-orange-500 text-white";
    }
    else if (["advance_payment_received", "balance_received"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Document status colors
    else if (["import_doc_pending"].includes(status)) {
      badgeClass = "bg-red-600 text-white";
    }
    else if (["import_doc_received", "pod_sent", "expense_documents_sent"].includes(status)) {
      badgeClass = "bg-green-600 text-white";
    }
    // Closed status for all categories
    else if (status === "closed") {
      badgeClass = "bg-muted-foreground/60 text-primary-foreground";
    }
    else {
      badgeClass = "bg-gray-500/20 text-gray-700 dark:text-gray-400";
    }

    return (
      <Badge className={badgeClass}>
        {statusLabel(status)}
      </Badge>
    );
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="space-y-4">
          {/* Header with Logo and Title */}
          <div className="p-4 md:p-6 rounded-lg flex flex-col sm:flex-row items-center space-y-3 sm:space-y-0 sm:space-x-6">
            {/* Logo Section */}
            <div className="flex-shrink-0">
              <img
                src={getCompanyLogo(procedure.reference)}
                alt={t("procedurePages.details.companyLogoAlt")}
                className="h-20 w-20 md:h-24 md:w-24 object-contain"
              />
            </div>

            {/* Text Section */}
            <div className="flex-grow text-center sm:text-left">
              <h1 className="text-2xl font-bold">{procedure.reference}</h1>
              <p className="text-muted-foreground mt-1">{t("procedurePages.details.overviewSubtitle")}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.shipmentStatusLabel")}</span>
              {formatStatusBadge(procedure.shipment_status)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.paymentStatusLabel")}</span>
              {formatStatusBadge(procedure.payment_status)}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium whitespace-nowrap">{t("procedurePages.details.documentStatusLabel")}</span>
              {formatStatusBadge(procedure.document_status)}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.shipperInformation")}</h4>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.shipperField")}</span>
                <p className="font-medium">{procedure.shipper}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceNumberField")}</span>
                <p className="font-medium">{procedure.invoice_no}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceDateField")}</span>
                <p className="font-medium">{formatDateWithFallback(procedure.invoice_date)}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.invoiceAmountField")}</span>
                <p className="font-medium">{formatCurrency(procedure.amount, procedure.currency || 'TRY')}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.shipmentDetails")}</h4>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.packageTypeField")}</span>
                <p className="font-medium">{procedure.package}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.weightField")}</span>
                <p className="font-medium">{procedure.kg} kg</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.piecesField")}</span>
                <p className="font-medium">{procedure.piece}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.arrivalDateField")}</span>
                <p className="font-medium">{formatDateWithFallback(procedure.arrival_date)}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.transportationDetails")}</h4>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.awbNumberField")}</span>
                <p className="font-medium">{procedure.awb_number}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.carrierField")}</span>
                <p className="font-medium">{procedure.carrier}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.customsOfficeField")}</span>
                <p className="font-medium">{procedure.customs}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-medium mb-2 underline">{t("procedurePages.details.importDeclaration")}</h4>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.declarationNumberField")}</span>
                <p className="font-medium">{procedure.import_dec_number || t("procedurePages.details.notAvailable")}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.declarationDateField")}</span>
                <p className="font-medium">{formatDateWithFallback(procedure.import_dec_date)}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{t("procedurePages.details.customsFileNoField")}</span>
                <p className="font-medium">{procedure.customs_file_no || t("procedurePages.details.notAvailable")}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
