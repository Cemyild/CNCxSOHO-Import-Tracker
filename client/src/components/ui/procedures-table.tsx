import * as React from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { 
  ColumnDef, 
  ColumnFiltersState, 
  FilterFn, 
  PaginationState, 
  Row, 
  SortingState, 
  VisibilityState, 
  flexRender, 
  getCoreRowModel, 
  getFacetedUniqueValues, 
  getFilteredRowModel, 
  getPaginationRowModel, 
  getSortedRowModel, 
  useReactTable 
} from "@tanstack/react-table";
import { 
  ChevronDown, 
  ChevronFirst, 
  ChevronLast, 
  ChevronLeft, 
  ChevronRight, 
  ChevronUp, 
  CircleAlert, 
  CircleX, 
  Columns3, 
  Ellipsis, 
  Filter, 
  ListFilter, 
  Plus, 
  Trash 
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  DropdownMenu, 
  DropdownMenuCheckboxItem, 
  DropdownMenuContent, 
  DropdownMenuGroup, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuPortal, 
  DropdownMenuSeparator, 
  DropdownMenuShortcut, 
  DropdownMenuSub, 
  DropdownMenuSubContent, 
  DropdownMenuSubTrigger, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Table, 
  TableBody, 
  TableCaption, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogTrigger 
} from "@/components/ui/alert-dialog";

import { ExcelDataEnrichment } from "@/components/ExcelDataEnrichment";

import type { Procedure } from "@shared/schema";

// Custom filter function for multi-column searching
const multiColumnFilterFn: FilterFn<Procedure> = (row, columnId, filterValue) => {
  const searchableRowContent = `${row.original.reference || ''} ${row.original.shipper || ''} ${row.original.invoice_no || ''} ${row.original.awb_number || ''}`.toLowerCase();
  const searchTerm = (filterValue ?? "").toLowerCase();
  return searchableRowContent.includes(searchTerm);
};

const statusFilterFn: FilterFn<Procedure> = (row, columnId, filterValue: string[]) => {
  if (!filterValue?.length) return true;
  const status = row.getValue(columnId) as string;
  return filterValue.includes(status);
};

export function ProceduresTable() {
  const id = useId();
  const [, setLocation] = useLocation();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const [sorting, setSorting] = useState<SortingState>([]);

  // Fetch current user data to check role
  const { data: currentUser } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    },
  });

  // Check if current user is admin
  const isAdmin = currentUser?.role === 'admin';

  // Fetch procedures data
  const { data: { procedures = [] } = {}, isLoading, error, refetch } = useQuery<{ procedures: Procedure[] }>({
    queryKey: ['/api/procedures'],
  });

  // Deletion now happens on a per-row basis in the action menu

const columns: ColumnDef<Procedure>[] = [
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex justify-start">
              <Button size="icon" variant="ghost" className="shadow-none" aria-label="Actions for procedure">
                <Ellipsis size={16} strokeWidth={2} aria-hidden="true" />
              </Button>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuGroup>
              <Link href={`/procedure-details?reference=${encodeURIComponent(row.original.reference || "")}`}>
                <DropdownMenuItem>
                  <span>View details</span>
                </DropdownMenuItem>
              </Link>
              {isAdmin && (
                <DropdownMenuItem
                  onClick={() => setLocation(`/edit-procedure?reference=${encodeURIComponent(row.original.reference || "")}`)}
                >
                  <span>Edit</span>
                  <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600 focus:text-red-600">
                        <span>Delete</span>
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete procedure?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently remove this procedure. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/procedures/${row.original.id}`, {
                                method: 'DELETE',
                              });
                              
                              if (!res.ok) {
                                throw new Error("Failed to delete procedure");
                              }
                              
                              // Refresh the list
                              refetch();
                            } catch (error) {
                              console.error("Error deleting procedure:", error);
                              alert("Failed to delete procedure");
                            }
                          }}
                        >Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
      size: 60,
      enableHiding: false,
    },
    {
      header: "Reference",
      accessorKey: "reference",
      cell: ({ row }) => <div className="font-medium whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("reference") || "-"}</div>,
      size: 120,
      filterFn: multiColumnFilterFn,
      enableHiding: false,
    },
    {
      header: "Shipper",
      accessorKey: "shipper",
      cell: ({ row }) => {
        const value = row.getValue("shipper") as string || "-";
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[150px]">{value}</div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{value}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
      size: 150,
    },
    {
      header: "Invoice #",
      accessorKey: "invoice_no",
      cell: ({ row }) => {
        const value = row.getValue("invoice_no") as string || "-";
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[100px]">{value}</div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{value}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      },
      size: 100,
    },
    {
      header: "Invoice Date",
      accessorKey: "invoice_date",
      cell: ({ row }) => {
        const dateString = row.getValue("invoice_date") as string | null;
        if (!dateString) return <div>-</div>;
        
        // Parse the UTC date from the ISO string
        const date = new Date(dateString);
        
        // Format directly using UTC components to avoid timezone issues
        if (isNaN(date.getTime())) return <div>-</div>;
        
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = date.getUTCFullYear();
        
        return <div>{`${day}.${month}.${year}`}</div>;
      },
      size: 120,
    },
    {
      header: "Amount",
      accessorKey: "amount",
      cell: ({ row }) => {
        const amount = parseFloat(row.getValue("amount") || "0");
        const currency = row.original.currency || "TRY";
        const formatted = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: currency,
        }).format(amount);
        return <div>{formatted}</div>;
      },
      size: 100,
    },

    {
      header: "Piece",
      accessorKey: "piece",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("piece") || "-"}</div>,
      size: 80,
    },
    {
      header: "Shipment Status",
      accessorKey: "shipment_status",
      cell: ({ row }) => {
        const status = row.getValue("shipment_status") as string;
        if (!status) {
          return (
            <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
              <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30 w-full text-center">
                None
              </Badge>
            </div>
          );
        }

        let formattedStatus = "";
        let badgeClass = "";

        // Format specific shipment statuses with proper spacing and color coding
        switch(status.toLowerCase()) {
          case "created":
            formattedStatus = "Created";
            badgeClass = "bg-yellow-500 text-white";
            break;
          case "arrived":
            formattedStatus = "Arrived";
            badgeClass = "bg-green-600 text-white";
            break;
          case "tareks_application":
            formattedStatus = "Tareks Application";
            badgeClass = "bg-red-600 text-white";
            break;
          case "tareks_approved":
            formattedStatus = "Tareks Approved";
            badgeClass = "bg-green-600 text-white";
            break;
          case "import_started":
            formattedStatus = "Import Started";
            badgeClass = "bg-yellow-500 text-white";
            break;
          case "import_finished":
            formattedStatus = "Import Finished";
            badgeClass = "bg-green-600 text-white";
            break;
          case "delivered":
            formattedStatus = "Delivered";
            badgeClass = "bg-green-600 text-white";
            break;
          case "closed":
            formattedStatus = "Closed";
            badgeClass = "bg-muted-foreground/60 text-primary-foreground";
            break;
          default:
            formattedStatus = status.split('_')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
            badgeClass = "bg-yellow-500 text-white"; // Default to yellow
        }

        return (
          <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
              {formattedStatus}
            </Badge>
          </div>
        );
      },
      minSize: 150,
      maxSize: 280,
      filterFn: statusFilterFn,
    },
    {
      header: "Document Status",
      accessorKey: "document_status",
      cell: ({ row }) => {
        const status = row.getValue("document_status") as string;
        if (!status) {
          return (
            <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
              <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30 w-full text-center">
                None
              </Badge>
            </div>
          );
        }

        let formattedStatus = "";
        let badgeClass = "";

        // Format specific document statuses with proper spacing and color coding
        switch(status.toLowerCase()) {
          case "tax_calc_insurance_sent":
            formattedStatus = "Tax Calc & Insurance Sent";
            badgeClass = "bg-yellow-500 text-white";
            break;
          case "import_doc_pending":
            formattedStatus = "Import Doc. Pending";
            badgeClass = "bg-red-600 text-white";
            break;
          case "import_doc_received":
            formattedStatus = "Import Doc. Received";
            badgeClass = "bg-green-600 text-white";
            break;
          case "pod_sent":
            formattedStatus = "POD Sent";
            badgeClass = "bg-green-600 text-white";
            break;
          case "expense_documents_sent":
            formattedStatus = "Expense & Documents Sent";
            badgeClass = "bg-green-600 text-white";
            break;
          case "closed":
            formattedStatus = "Closed";
            badgeClass = "bg-muted-foreground/60 text-primary-foreground";
            break;
          default:
            // Handle any other statuses by replacing underscores with spaces and capitalize
            formattedStatus = status.split('_')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
            badgeClass = "bg-yellow-500 text-white"; //Default to yellow
        }

        return (
          <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
              {formattedStatus}
            </Badge>
          </div>
        );
      },
      minSize: 150,
      maxSize: 280,
      filterFn: statusFilterFn,
    },
    {
      header: "Payment Status",
      accessorKey: "payment_status",
      cell: ({ row }) => {
        const status = row.getValue("payment_status") as string;
        if (!status) {
          return (
            <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
              <Badge className="bg-gray-500/20 text-gray-700 dark:text-gray-400 hover:bg-gray-500/30 w-full text-center">
                None
              </Badge>
            </div>
          );
        }

        let formattedStatus = "";
        let badgeClass = "";

        // Format specific payment statuses with proper spacing and color coding
        switch(status.toLowerCase()) {
          case "advance_taxletter_sent":
            formattedStatus = "Advance Taxletter Sent";
            badgeClass = "bg-yellow-500 text-white";
            break;
          case "advance_payment_received":
            formattedStatus = "Advance Payment Received";
            badgeClass = "bg-green-600 text-white";
            break;
          case "final_balance_letter_sent":
            formattedStatus = "Final Balance Letter Sent";
            badgeClass = "bg-red-600 text-white";
            break;
          case "balance_received":
            formattedStatus = "Balance Received";
            badgeClass = "bg-green-600 text-white";
            break;
          case "closed":
            formattedStatus = "Closed";
            badgeClass = "bg-muted-foreground/60 text-primary-foreground";
            break;
          default:
            // Handle any other statuses by replacing underscores with spaces and capitalize
            formattedStatus = status.split('_')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
            badgeClass = "bg-yellow-500 text-white"; //Default to yellow
        }

        return (
          <div className="min-w-[120px] max-w-[280px] w-full flex justify-center">
            <Badge className={cn(badgeClass, "break-normal w-full text-center")}>
              {formattedStatus}
            </Badge>
          </div>
        );
      },
      minSize: 150,
      maxSize: 280,
      filterFn: statusFilterFn,
    },
    {
      header: "Package",
      accessorKey: "package",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("package") || "-"}</div>,
      size: 100,
    },
    {
      header: "KG",
      accessorKey: "kg",
      cell: ({ row }) => {
        const kg = parseFloat(row.getValue("kg") || "0");
        return <div>{kg.toFixed(2)}</div>;
      },
      size: 80,
    },
    {
      header: "AWB #",
      accessorKey: "awb_number",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("awb_number") || "-"}</div>,
      size: 120,
    },
    {
      header: "Arrival Date",
      accessorKey: "arrival_date",
      cell: ({ row }) => {
        const dateString = row.getValue("arrival_date") as string | null;
        if (!dateString) return <div>-</div>;
        
        // Parse the UTC date from the ISO string
        const date = new Date(dateString);
        
        // Format directly using UTC components to avoid timezone issues
        if (isNaN(date.getTime())) return <div>-</div>;
        
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = date.getUTCFullYear();
        
        return <div>{`${day}.${month}.${year}`}</div>;
      },
      size: 120,
    },
    {
      header: "Carrier",
      accessorKey: "carrier",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("carrier") || "-"}</div>,
      size: 120,
    },
    {
      header: "Customs",
      accessorKey: "customs",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("customs") || "-"}</div>,
      size: 120,
    },
    {
      header: "Import Dec #",
      accessorKey: "import_dec_number",
      cell: ({ row }) => <div className="whitespace-nowrap overflow-hidden text-ellipsis">{row.getValue("import_dec_number") || "-"}</div>,
      size: 140,
    },
    {
      header: "Import Dec Date",
      accessorKey: "import_dec_date",
      cell: ({ row }) => {
        const dateString = row.getValue("import_dec_date") as string | null;
        if (!dateString) return <div>-</div>;
        
        // Parse the UTC date from the ISO string
        const date = new Date(dateString);
        
        // Format directly using UTC components to avoid timezone issues
        if (isNaN(date.getTime())) return <div>-</div>;
        
        const day = date.getUTCDate().toString().padStart(2, '0');
        const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
        const year = date.getUTCFullYear();
        
        return <div>{`${day}.${month}.${year}`}</div>;
      },
      size: 140,
    },
  ];

  const table = useReactTable({
    data: procedures,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    enableSortingRemoval: false,
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    state: {
      sorting,
      pagination,
      columnFilters,
      columnVisibility,
    },
  });

  // Get unique document status values
  const uniqueDocumentStatusValues = useMemo(() => {
    const statusColumn = table.getColumn("document_status");

    if (!statusColumn) return [];

    const values = Array.from(statusColumn.getFacetedUniqueValues().keys()).filter(Boolean);

    return values.sort();
  }, [table.getColumn("document_status")?.getFacetedUniqueValues()]);

  // Get unique payment status values
  const uniquePaymentStatusValues = useMemo(() => {
    const statusColumn = table.getColumn("payment_status");

    if (!statusColumn) return [];

    const values = Array.from(statusColumn.getFacetedUniqueValues().keys()).filter(Boolean);

    return values.sort();
  }, [table.getColumn("payment_status")?.getFacetedUniqueValues()]);

  // Get unique shipment status values
  const uniqueShipmentStatusValues = useMemo(() => {
    const statusColumn = table.getColumn("shipment_status");

    if (!statusColumn) return [];

    const values = Array.from(statusColumn.getFacetedUniqueValues().keys()).filter(Boolean);

    return values.sort();
  }, [table.getColumn("shipment_status")?.getFacetedUniqueValues()]);

  // Get counts for each status type
  const documentStatusCounts = useMemo(() => {
    const statusColumn = table.getColumn("document_status");
    if (!statusColumn) return new Map();
    return statusColumn.getFacetedUniqueValues();
  }, [table.getColumn("document_status")?.getFacetedUniqueValues()]);

  const paymentStatusCounts = useMemo(() => {
    const statusColumn = table.getColumn("payment_status");
    if (!statusColumn) return new Map();
    return statusColumn.getFacetedUniqueValues();
  }, [table.getColumn("payment_status")?.getFacetedUniqueValues()]);

  const shipmentStatusCounts = useMemo(() => {
    const statusColumn = table.getColumn("shipment_status");
    if (!statusColumn) return new Map();
    return statusColumn.getFacetedUniqueValues();
  }, [table.getColumn("shipment_status")?.getFacetedUniqueValues()]);

  // Track selected statuses for each type
  const selectedDocumentStatuses = useMemo(() => {
    const filterValue = table.getColumn("document_status")?.getFilterValue() as string[];
    return filterValue ?? [];
  }, [table.getColumn("document_status")?.getFilterValue()]);

  const selectedPaymentStatuses = useMemo(() => {
    const filterValue = table.getColumn("payment_status")?.getFilterValue() as string[];
    return filterValue ?? [];
  }, [table.getColumn("payment_status")?.getFilterValue()]);

  const selectedShipmentStatuses = useMemo(() => {
    const filterValue = table.getColumn("shipment_status")?.getFilterValue() as string[];
    return filterValue ?? [];
  }, [table.getColumn("shipment_status")?.getFilterValue()]);

  // Combined count of all selected filters
  const totalSelectedStatuses = useMemo(() => {
    return selectedDocumentStatuses.length + selectedPaymentStatuses.length + selectedShipmentStatuses.length;
  }, [selectedDocumentStatuses, selectedPaymentStatuses, selectedShipmentStatuses]);

  // Handle status changes for all status types
  const handleDocumentStatusChange = (checked: boolean, value: string) => {
    const filterValue = table.getColumn("document_status")?.getFilterValue() as string[];
    const newFilterValue = filterValue ? [...filterValue] : [];

    if (checked) {
      newFilterValue.push(value);
    } else {
      const index = newFilterValue.indexOf(value);
      if (index > -1) {
        newFilterValue.splice(index, 1);
      }
    }

    table.getColumn("document_status")?.setFilterValue(newFilterValue.length ? newFilterValue : undefined);
  };

  const handlePaymentStatusChange = (checked: boolean, value: string) => {
    const filterValue = table.getColumn("payment_status")?.getFilterValue() as string[];
    const newFilterValue = filterValue ? [...filterValue] : [];

    if (checked) {
      newFilterValue.push(value);
    } else {
      const index = newFilterValue.indexOf(value);
      if (index > -1) {
        newFilterValue.splice(index, 1);
      }
    }

    table.getColumn("payment_status")?.setFilterValue(newFilterValue.length ? newFilterValue : undefined);
  };

  const handleShipmentStatusChange = (checked: boolean, value: string) => {
    const filterValue = table.getColumn("shipment_status")?.getFilterValue() as string[];
    const newFilterValue = filterValue ? [...filterValue] : [];

    if (checked) {
      newFilterValue.push(value);
    } else {
      const index = newFilterValue.indexOf(value);
      if (index > -1) {
        newFilterValue.splice(index, 1);
      }
    }

    table.getColumn("shipment_status")?.setFilterValue(newFilterValue.length ? newFilterValue : undefined);
  };

  function getStatusBadgeColor(status: string): string {
    switch (status.toLowerCase()) {
      case "arrived":
        return "bg-green-600 text-white";
      case "closed":
        return "bg-muted-foreground/60 text-primary-foreground";
      case "expense_documents_sent":
        return "bg-green-600 text-white";
      default:
        return "bg-yellow-500 text-white";
    }
  }

  if (error) {
    return <div className="p-4 text-red-500">Error loading procedures: {String(error)}</div>;
  }

  if (isLoading) {
    return <div className="p-4">Loading procedures...</div>;
  }

  return (
    <div className="w-full space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Filter by reference, shipper or invoice */}
          <div className="relative">
            <Input
              id={`${id}-input`}
              ref={inputRef}
              className={cn(
                "peer min-w-60 ps-9",
                Boolean(table.getColumn("reference")?.getFilterValue()) && "pe-9",
              )}
              value={(table.getColumn("reference")?.getFilterValue() ?? "") as string}
              onChange={(e) => table.getColumn("reference")?.setFilterValue(e.target.value)}
              placeholder="Filter by reference, shipper..."
              type="text"
              aria-label="Filter by reference or shipper"
            />
            <div className="pointer-events-none absolute inset-y-0 start-0 flex items-center justify-center ps-3 text-muted-foreground/80 peer-disabled:opacity-50">
              <ListFilter size={16} strokeWidth={2} aria-hidden="true" />
            </div>
            {Boolean(table.getColumn("reference")?.getFilterValue()) && (
              <button
                className="absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-lg text-muted-foreground/80 outline-offset-2 transition-colors hover:text-foreground focus:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Clear filter"
                onClick={() => {
                  table.getColumn("reference")?.setFilterValue("");
                  if (inputRef.current) {
                    inputRef.current.focus();
                  }
                }}
              >
                <CircleX size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
          {/* Filter by status */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <Filter
                  className="-ms-1 me-2 opacity-60"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Status
                {totalSelectedStatuses > 0 && (
                  <span className="-me-1 ms-3 inline-flex h-5 max-h-full items-center rounded border border-border bg-background px-1 font-[inherit] text-[0.625rem] font-medium text-muted-foreground/70">
                    {totalSelectedStatuses}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="min-w-80 p-4" align="start">
              <div className="space-y-4">
                {/* Document Status */}
                <div>
                  <div className="mb-2 text-sm font-medium">Document Status</div>
                  <div className="space-y-2">
                    {uniqueDocumentStatusValues.length > 0 ? (
                      uniqueDocumentStatusValues.map((value: string, i: number) => (
                        <div key={value} className="flex items-center gap-2">
                          <Checkbox
                            id={`doc-${id}-${i}`}
                            checked={selectedDocumentStatuses.includes(value)}
                            onCheckedChange={(checked: boolean) => handleDocumentStatusChange(checked, value)}
                          />
                          <Label
                            htmlFor={`doc-${id}-${i}`}
                            className="flex grow justify-between gap-2 font-normal"
                          >
                            {value && value.charAt(0).toUpperCase() + value.slice(1)}{" "}
                            <span className="ms-2 text-xs text-muted-foreground">
                              {documentStatusCounts.get(value)}
                            </span>
                          </Label>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No document statuses found.</div>
                    )}
                  </div>
                </div>
                {/* Payment Status */}
                <div>
                  <div className="mb-2 text-sm font-medium">Payment Status</div>
                  <div className="space-y-2">
                    {uniquePaymentStatusValues.length > 0 ? (
                      uniquePaymentStatusValues.map((value: string, i: number) => (
                        <div key={value} className="flex items-center gap-2">
                          <Checkbox
                            id={`pay-${id}-${i}`}
                            checked={selectedPaymentStatuses.includes(value)}
                            onCheckedChange={(checked: boolean) => handlePaymentStatusChange(checked, value)}
                          />
                          <Label
                            htmlFor={`pay-${id}-${i}`}
                            className="flex grow justify-between gap-2 font-normal"
                          >
                            {value && value.charAt(0).toUpperCase() + value.slice(1)}{" "}
                            <span className="ms-2 text-xs text-muted-foreground">
                              {paymentStatusCounts.get(value)}
                            </span>
                          </Label>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No payment statuses found.</div>
                    )}
                  </div>
                </div>
                {/* Shipment Status */}
                <div>
                  <div className="mb-2 text-sm font-medium">Shipment Status</div>
                  <div className="space-y-2">
                    {uniqueShipmentStatusValues.length > 0 ? (
                      uniqueShipmentStatusValues.map((value: string, i: number) => (
                        <div key={value} className="flex items-center gap-2">
                          <Checkbox
                            id={`ship-${id}-${i}`}
                            checked={selectedShipmentStatuses.includes(value)}
                            onCheckedChange={(checked: boolean) => handleShipmentStatusChange(checked, value)}
                          />
                          <Label
                            htmlFor={`ship-${id}-${i}`}
                            className="flex grow justify-between gap-2 font-normal"
                          >
                            {value && value.charAt(0).toUpperCase() + value.slice(1)}{" "}
                            <span className="ms-2 text-xs text-muted-foreground">
                              {shipmentStatusCounts.get(value)}
                            </span>
                          </Label>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No shipment statuses found.</div>
                    )}
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          {/* Column visibility */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns3
                  className="-ms-1 me-2 opacity-60"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {column.id.charAt(0).toUpperCase() + column.id.slice(1).replace(/_/g, " ")}
                    </DropdownMenuCheckboxItem>
                  );
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          {/* Row size with dropdown selector */}
          <Label htmlFor={`${id}-rows-per-page`} className="text-xs">
            Per page
          </Label>
          <Select
            value={table.getState().pagination.pageSize.toString()}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className="h-8 w-16">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {[5, 10, 15, 20, 25, 50, 100].map((pageSize) => (
                <SelectItem key={pageSize} value={pageSize.toString()}>
                  {pageSize}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Add button for creating a new procedure - Admin only */}
          <ExcelDataEnrichment onSuccess={() => refetch()} />
          {isAdmin && (
            <Link href="/add-procedure">
              <Button>
                <Plus
                  className="-ms-1 me-2"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                New
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* No more multi-select delete button needed */}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{
                        width: header.getSize() !== Number.MAX_SAFE_INTEGER ? header.getSize() : undefined,
                      }}
                      className="whitespace-nowrap"
                    >
                      {header.isPlaceholder ? null : (
                        <div
                          {...{
                            className: cn(
                              "flex items-center justify-center gap-1",
                              header.column.getCanSort() &&
                                "cursor-pointer select-none hover:text-foreground"
                            ),
                            onClick: header.column.getToggleSortingHandler(),
                          }}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {{
                            asc: <ChevronUp size={14} strokeWidth={2} className="-mr-1 opacity-60" />,
                            desc: <ChevronDown size={14} strokeWidth={2} className="-mr-1 opacity-60" />,
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{
                        width: cell.column.getSize() !== Number.MAX_SAFE_INTEGER
                          ? cell.column.getSize()
                          : undefined,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing{" "}
          <span className="font-medium">
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
          </span>{" "}
          to{" "}
          <span className="font-medium">
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )}
          </span>{" "}
          of <span className="font-medium">{table.getFilteredRowModel().rows.length}</span> results
        </div>
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
                className="hidden h-8 w-8 sm:flex"
              >
                <span className="sr-only">Go to first page</span>
                <ChevronFirst size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="h-8 w-8"
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="h-8 w-8"
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
                className="hidden h-8 w-8 sm:flex"
              >
                <span className="sr-only">Go to last page</span>
                <ChevronLast size={16} strokeWidth={2} />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}