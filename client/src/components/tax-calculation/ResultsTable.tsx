import { useState, Fragment } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RequirementsBadge } from "./RequirementsBadge";

function formatCurrency(value: string | number | null | undefined): string {
  if (!value) return "0.00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface TaxCalculationItem {
  id: number;
  style: string;
  cost: string;
  unit_count: number;
  tr_hs_code?: string | null;
  cif_value?: string | null;
  customs_tax?: string | null;
  additional_customs_tax?: string | null;
  kkdf?: string | null;
  vat?: string | null;
  total_tax_usd?: string | null;
  total_tax_tl?: string | null;
  transport_share?: string | null;
  insurance_share?: string | null;
  storage_share?: string | null;
  vat_base?: string | null;
  total_value?: string | null;
  requirements?: string | null;
}

interface ResultsTableProps {
  items: TaxCalculationItem[];
}

export function ResultsTable({ items }: ResultsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  return (
    <div className="border rounded-lg overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Style</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Units</TableHead>
            <TableHead>TR HS CODE</TableHead>
            <TableHead>CIF Value</TableHead>
            <TableHead>Customs Tax</TableHead>
            <TableHead>Add. Tax</TableHead>
            <TableHead>KKDF</TableHead>
            <TableHead>VAT</TableHead>
            <TableHead>Total Tax (USD)</TableHead>
            <TableHead>Total Tax (TL)</TableHead>
            <TableHead>Requirements</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                No calculation results available
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <Fragment key={`fragment-${item.id}`}>
                <TableRow className="cursor-pointer hover:bg-muted/50">
                  <TableCell onClick={() => toggleRow(item.id)}>
                    {expandedRows.has(item.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium" data-testid={`text-style-${item.id}`}>
                    {item.style}
                  </TableCell>
                  <TableCell>${formatCurrency(item.cost)}</TableCell>
                  <TableCell>{item.unit_count}</TableCell>
                  <TableCell className="font-mono text-xs">{item.tr_hs_code || "-"}</TableCell>
                  <TableCell>${formatCurrency(item.cif_value)}</TableCell>
                  <TableCell>${formatCurrency(item.customs_tax)}</TableCell>
                  <TableCell>${formatCurrency(item.additional_customs_tax)}</TableCell>
                  <TableCell>${formatCurrency(item.kkdf)}</TableCell>
                  <TableCell>${formatCurrency(item.vat)}</TableCell>
                  <TableCell className="font-bold">${formatCurrency(item.total_tax_usd)}</TableCell>
                  <TableCell className="font-bold">₺{formatCurrency(item.total_tax_tl)}</TableCell>
                  <TableCell>
                    <RequirementsBadge
                      requirements={{
                        ex_registry_form: item.requirements?.includes('EX REGISTRY FORM') || false,
                        azo_dye_test: item.requirements?.includes('AZO DYE TEST') || false,
                        special_custom: item.requirements?.includes('SPECIAL CUSTOM') || false,
                      }}
                    />
                  </TableCell>
                </TableRow>
                {expandedRows.has(item.id) && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={13}>
                      <div className="px-4 py-3 space-y-2 text-sm">
                        <div className="font-semibold">Breakdown:</div>
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <span className="text-muted-foreground">Transport Share:</span>
                            <span className="ml-2 font-medium">${formatCurrency(item.transport_share)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Insurance Share:</span>
                            <span className="ml-2 font-medium">${formatCurrency(item.insurance_share)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Storage Share:</span>
                            <span className="ml-2 font-medium">${formatCurrency(item.storage_share)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">VAT Base:</span>
                            <span className="ml-2 font-medium">${formatCurrency(item.vat_base)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total Value:</span>
                            <span className="ml-2 font-medium">${formatCurrency(item.total_value)}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
