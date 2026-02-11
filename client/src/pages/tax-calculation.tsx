import { 
  Calendar,
  Home,
  Inbox,
  Search,
  Settings,
  BarChart2,
  Calculator,
  Plus,
  Eye,
  Edit,
  Trash2,
  FileText,
  Upload,
  Database,
  CheckCircle
} from "lucide-react";
import { PageLayout } from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import type { TaxCalculation } from "@shared/schema";

function formatCurrency(value: string | number | null | undefined): string {
  if (!value) return "0.00";
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const items = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: Home,
  },
  {
    title: "Procedures",
    url: "/procedures",
    icon: Inbox,
  },
  {
    title: "Expenses",
    url: "/expenses",
    icon: Calendar,
  },
  {
    title: "Payments",
    url: "/payments",
    icon: Search,
  },
  {
    title: "Tax Calculation",
    url: "/tax-calculation",
    icon: Calculator,
  },
  {
    title: "Reports",
    url: "/reports",
    icon: BarChart2,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export default function TaxCalculationPage() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const productsFileInputRef = useRef<HTMLInputElement>(null);
  const hsCodesFileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery<{ calculations: TaxCalculation[] }>({
    queryKey: ["/api/tax-calculation/calculations"],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/tax-calculation/calculations/${id}`);
      if (!response.ok) throw new Error("Failed to delete calculation");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tax-calculation/calculations"] });
      toast({
        title: "Success",
        description: "Calculation deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete calculation",
        variant: "destructive",
      });
    },
  });

  const handleImportProducts = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      setIsImporting(true);
      
      const response = await fetch('/api/tax-calculation/import-products', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.details || result.error || 'Import failed');
      }
      
      // Show detailed stats if available
      if (result.stats) {
        const { newlyImported, duplicatesInExcel, alreadyInDatabase, totalInExcel } = result.stats;
        toast({
          title: "Import Complete",
          description: (
            <div className="space-y-1">
              <div>✅ New products imported: {newlyImported}</div>
              {duplicatesInExcel > 0 && <div>⚠️ Duplicate styles in Excel: {duplicatesInExcel}</div>}
              {alreadyInDatabase > 0 && <div>ℹ️ Already in database: {alreadyInDatabase}</div>}
              <div className="text-xs text-muted-foreground mt-2">Total rows: {totalInExcel}</div>
            </div>
          ),
          duration: 5000,
        });
      } else {
        toast({
          title: "Success",
          description: `✅ ${result.message}`,
        });
      }
      
    } catch (error) {
      toast({
        title: "Error",
        description: `❌ Failed to import products: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      if (productsFileInputRef.current) {
        productsFileInputRef.current.value = '';
      }
    }
  };

  const handleImportHSCodes = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      setIsImporting(true);
      
      const response = await fetch('/api/tax-calculation/import-hs-codes', {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.details || result.error || 'Import failed');
      }
      
      toast({
        title: "Success",
        description: `✅ ${result.message}`,
      });
      
    } catch (error) {
      toast({
        title: "Error",
        description: `❌ Failed to import HS codes: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
      if (hsCodesFileInputRef.current) {
        hsCodesFileInputRef.current.value = '';
      }
    }
  };

  const calculations = data?.calculations || [];
  const filteredCalculations = calculations.filter(calc => {
    const ref = calc.reference?.toLowerCase() ?? '';
    return ref.includes(searchTerm.toLowerCase());
  });

  const getStatusBadge = (status: string) => {
    const statusMap = {
      draft: { label: "Draft", className: "bg-gray-500" },
      calculated: { label: "Calculated", className: "bg-blue-500" },
      completed: { label: "Completed", className: "bg-green-500" },
    };
    const statusInfo = statusMap[status as keyof typeof statusMap] || statusMap.draft;
    return <Badge className={statusInfo.className}>{statusInfo.label}</Badge>;
  };

  return (
    <PageLayout title="Tax Calculation" navItems={items}>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Tax Calculations</h1>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => productsFileInputRef.current?.click()}
              disabled={isImporting}
              data-testid="button-import-products"
            >
              <Upload className="mr-2 h-4 w-4" />
              {isImporting ? "Importing..." : "Import Products"}
            </Button>
            <Button
              variant="outline"
              onClick={() => hsCodesFileInputRef.current?.click()}
              disabled={isImporting}
              data-testid="button-import-hs-codes"
            >
              <Database className="mr-2 h-4 w-4" />
              {isImporting ? "Importing..." : "Import HS Codes"}
            </Button>
            <Link href="/tax-calculation/new">
              <Button data-testid="button-new-calculation">
                <Plus className="mr-2 h-4 w-4" />
                New Calculation
              </Button>
            </Link>
          </div>
        </div>

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportProducts(file);
          }}
          className="hidden"
          ref={productsFileInputRef}
          data-testid="input-products-file"
        />

        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportHSCodes(file);
          }}
          className="hidden"
          ref={hsCodesFileInputRef}
          data-testid="input-hscodes-file"
        />

        <div className="flex gap-4">
          <Input
            placeholder="Search by reference..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-sm"
            data-testid="input-search"
          />
        </div>

        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Invoice No</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Total Value</TableHead>
                <TableHead>Total Pieces</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filteredCalculations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No calculations found
                  </TableCell>
                </TableRow>
              ) : (
                filteredCalculations.map((calc) => (
                  <TableRow key={calc.id}>
                    <TableCell className="font-medium" data-testid={`text-reference-${calc.id}`}>
                      {calc.reference}
                    </TableCell>
                    <TableCell>{calc.invoice_no || "-"}</TableCell>
                    <TableCell>
                      {calc.invoice_date ? new Date(calc.invoice_date).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>${formatCurrency(calc.total_value)}</TableCell>
                    <TableCell>{(calc.total_quantity || 0).toLocaleString('en-US')}</TableCell>
                    <TableCell>
                      <div className="flex gap-2 items-center">
                        {getStatusBadge(calc.status || "draft")}
                        {calc.procedure_id && (
                          <Badge className="bg-emerald-600 flex items-center gap-1" data-testid={`badge-procedure-${calc.id}`}>
                            <CheckCircle className="h-3 w-3" />
                            Procedure Created
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Link href={`/tax-calculation/${calc.id}`}>
                          <Button variant="ghost" size="sm" data-testid={`button-view-${calc.id}`}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                        <Link href={`/tax-calculation/${calc.id}/edit`}>
                          <Button variant="ghost" size="sm" data-testid={`button-edit-${calc.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        </Link>
                        {calc.status !== "completed" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this calculation?")) {
                                deleteMutation.mutate(calc.id);
                              }
                            }}
                            data-testid={`button-delete-${calc.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </PageLayout>
  );
}
