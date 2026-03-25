import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  DollarSign, CreditCard, Building, Banknote, ArrowDownRight, ArrowUpRight, 
  Download, Search, RefreshCw, FileText, Calendar
} from "lucide-react";
import Sidebar from "@/components/sidebar";

interface UnifiedTransaction {
  id: string;
  source: 'student_transaction' | 'payment_intake' | 'payment_transaction';
  date: string;
  amount: number;
  paymentMethod: string;
  transactionType: string;
  description: string;
  studentId: number | null;
  studentName: string | null;
  referenceNumber: string | null;
  status: string;
  notes: string | null;
  createdAt: string | null;
}

interface TransactionSummary {
  totalTransactions: number;
  totalAmount: number;
  totalRefunds: number;
  byMethod: Record<string, { count: number; amount: number }>;
  byType: Record<string, { count: number; amount: number }>;
}

interface AuditResponse {
  transactions: UnifiedTransaction[];
  summary: TransactionSummary;
}

const paymentMethodIcons: Record<string, JSX.Element> = {
  credit: <CreditCard className="w-4 h-4" />,
  card: <CreditCard className="w-4 h-4" />,
  debit: <CreditCard className="w-4 h-4" />,
  e_transfer: <Building className="w-4 h-4" />,
  etransfer: <Building className="w-4 h-4" />,
  "e-transfer": <Building className="w-4 h-4" />,
  cash: <Banknote className="w-4 h-4" />,
  cheque: <FileText className="w-4 h-4" />,
  check: <FileText className="w-4 h-4" />,
};

const paymentMethodLabels: Record<string, string> = {
  credit: "Credit Card",
  card: "Card",
  debit: "Debit Card",
  e_transfer: "E-Transfer",
  etransfer: "E-Transfer",
  "e-transfer": "E-Transfer",
  cash: "Cash",
  cheque: "Cheque",
  check: "Check",
  unknown: "Unknown",
};

const transactionTypeColors: Record<string, string> = {
  payment: "bg-green-100 text-green-800",
  charge: "bg-blue-100 text-blue-800",
  refund: "bg-red-100 text-red-800",
  adjustment: "bg-yellow-100 text-yellow-800",
};

export default function TransactionAudit() {
  const today = format(new Date(), "yyyy-MM-dd");
  const thirtyDaysAgo = format(subDays(new Date(), 30), "yyyy-MM-dd");
  
  const [dateRange, setDateRange] = useState({ start: thirtyDaysAgo, end: today });
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [transactionType, setTransactionType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, refetch } = useQuery<AuditResponse>({
    queryKey: ["/api/admin/transactions/audit", dateRange.start, dateRange.end, paymentMethod, transactionType, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateRange.start) params.append('startDate', dateRange.start);
      if (dateRange.end) params.append('endDate', dateRange.end);
      if (paymentMethod !== 'all') params.append('paymentMethod', paymentMethod);
      if (transactionType !== 'all') params.append('transactionType', transactionType);
      if (searchQuery) params.append('search', searchQuery);
      const response = await fetch(`/api/admin/transactions/audit?${params}`, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch transactions');
      return response.json();
    },
  });

  const transactions = data?.transactions || [];
  const summary = data?.summary || { 
    totalTransactions: 0, 
    totalAmount: 0, 
    totalRefunds: 0, 
    byMethod: {}, 
    byType: {} 
  };

  const exportToCSV = () => {
    if (!transactions.length) return;
    
    const headers = ["Date", "Type", "Method", "Amount", "Description", "Student", "Reference", "Status", "Source"];
    const rows = transactions.map(tx => [
      tx.date,
      tx.transactionType,
      paymentMethodLabels[tx.paymentMethod] || tx.paymentMethod,
      tx.amount.toFixed(2),
      tx.description.replace(/,/g, ';'),
      tx.studentName || '-',
      tx.referenceNumber || '-',
      tx.status,
      tx.source,
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transaction-audit-${dateRange.start}-to-${dateRange.end}.csv`;
    link.click();
  };

  const setQuickDateRange = (range: 'today' | 'week' | 'month' | 'quarter') => {
    const now = new Date();
    switch (range) {
      case 'today':
        setDateRange({ start: today, end: today });
        break;
      case 'week':
        setDateRange({ start: format(subDays(now, 7), 'yyyy-MM-dd'), end: today });
        break;
      case 'month':
        setDateRange({ 
          start: format(startOfMonth(now), 'yyyy-MM-dd'), 
          end: format(endOfMonth(now), 'yyyy-MM-dd') 
        });
        break;
      case 'quarter':
        setDateRange({ start: format(subDays(now, 90), 'yyyy-MM-dd'), end: today });
        break;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto md:pt-0 pt-16">
        <div className="p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#111111]" data-testid="text-page-title">Transaction Audit</h1>
              <p className="text-gray-600">Full audit and summary of all financial transactions</p>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={() => refetch()}
                data-testid="button-refresh"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </Button>
              <Button 
                onClick={exportToCSV}
                disabled={!transactions.length}
                className="bg-[#ECC462] text-[#111111] hover:bg-[#dbb655]"
                data-testid="button-export-csv"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-[#ECC462]">
              <CardHeader className="pb-2">
                <CardDescription>Total Transactions</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p className="text-2xl font-bold text-[#111111]" data-testid="text-total-transactions">
                    {summary.totalTransactions}
                  </p>
                )}
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-green-500">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4 text-green-600" />
                  Total Payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <p className="text-2xl font-bold text-green-600" data-testid="text-total-payments">
                    ${summary.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-red-500">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <ArrowUpRight className="w-4 h-4 text-red-600" />
                  Total Refunds
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <p className="text-2xl font-bold text-red-600" data-testid="text-total-refunds">
                    ${summary.totalRefunds.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </CardContent>
            </Card>
            
            <Card className="border-l-4 border-l-blue-500">
              <CardHeader className="pb-2">
                <CardDescription>Net Revenue</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <p className="text-2xl font-bold text-blue-600" data-testid="text-net-revenue">
                    ${(summary.totalAmount - summary.totalRefunds).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Breakdown by Payment Method */}
          {Object.keys(summary.byMethod).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Breakdown by Payment Method</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {Object.entries(summary.byMethod).map(([method, data]) => (
                    <div key={method} className="p-3 bg-gray-50 rounded-lg" data-testid={`breakdown-method-${method}`}>
                      <div className="flex items-center gap-2 text-gray-600 mb-1">
                        {paymentMethodIcons[method] || <DollarSign className="w-4 h-4" />}
                        <span className="text-sm capitalize">{paymentMethodLabels[method] || method}</span>
                      </div>
                      <p className="font-semibold">${data.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs text-gray-500">{data.count} transactions</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Filters */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Search className="w-5 h-5" />
                Filters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <Label>Quick Date Range</Label>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setQuickDateRange('today')} data-testid="button-date-today">Today</Button>
                    <Button size="sm" variant="outline" onClick={() => setQuickDateRange('week')} data-testid="button-date-week">Week</Button>
                    <Button size="sm" variant="outline" onClick={() => setQuickDateRange('month')} data-testid="button-date-month">Month</Button>
                    <Button size="sm" variant="outline" onClick={() => setQuickDateRange('quarter')} data-testid="button-date-quarter">Quarter</Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="start-date">Start Date</Label>
                  <Input
                    id="start-date"
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                    data-testid="input-start-date"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="end-date">End Date</Label>
                  <Input
                    id="end-date"
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                    data-testid="input-end-date"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger data-testid="select-payment-method">
                      <SelectValue placeholder="All Methods" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Methods</SelectItem>
                      <SelectItem value="credit">Credit Card</SelectItem>
                      <SelectItem value="debit">Debit Card</SelectItem>
                      <SelectItem value="e_transfer">E-Transfer</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Transaction Type</Label>
                  <Select value={transactionType} onValueChange={setTransactionType}>
                    <SelectTrigger data-testid="select-transaction-type">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="payment">Payments</SelectItem>
                      <SelectItem value="refund">Refunds</SelectItem>
                      <SelectItem value="charge">Charges</SelectItem>
                      <SelectItem value="adjustment">Adjustments</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="mt-4">
                <Label htmlFor="search">Search</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    id="search"
                    placeholder="Search by description, student name, or reference..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-search"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Transactions ({transactions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Student</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 10 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 8 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : transactions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-10 text-gray-500">
                          No transactions found for the selected filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      transactions.map((tx) => (
                        <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`}>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-4 h-4 text-gray-400" />
                              {tx.date}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className={transactionTypeColors[tx.transactionType] || "bg-gray-100 text-gray-800"}>
                              {tx.transactionType}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {paymentMethodIcons[tx.paymentMethod] || <DollarSign className="w-4 h-4" />}
                              <span className="capitalize">
                                {paymentMethodLabels[tx.paymentMethod] || tx.paymentMethod}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={tx.transactionType === 'refund' ? 'text-red-600' : 'text-green-600'}>
                              {tx.transactionType === 'refund' ? '-' : '+'}${Math.abs(tx.amount).toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-xs truncate" title={tx.description}>
                            {tx.description}
                          </TableCell>
                          <TableCell>
                            {tx.studentName || <span className="text-gray-400">-</span>}
                          </TableCell>
                          <TableCell>
                            {tx.referenceNumber ? (
                              <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                                {tx.referenceNumber}
                              </code>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={tx.status === 'completed' ? 'default' : 'secondary'}>
                              {tx.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
