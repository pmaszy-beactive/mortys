import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, CreditCard, Banknote, Receipt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

interface StudentTransaction {
  id: number;
  studentId: number;
  date: string;
  description: string;
  amount: string;
  gst: string;
  pst: string;
  total: string;
  transactionType: "payment" | "charge" | "refund" | "adjustment";
  paymentMethod?: string;
  referenceNumber?: string;
  notes?: string;
}

interface StatementOfAccountProps {
  studentId: number;
}

export function StatementOfAccount({ studentId }: StatementOfAccountProps) {
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const { toast } = useToast();

  const { data: transactions = [], isLoading } = useQuery<StudentTransaction[]>({
    queryKey: ["/api/student-transactions", studentId],
    queryFn: () => apiRequest("GET", `/api/student-transactions/${studentId}`),
  });

  const addTransactionMutation = useMutation({
    mutationFn: (transaction: Partial<StudentTransaction>) => 
      apiRequest("POST", "/api/student-transactions", { ...transaction, studentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-transactions", studentId] });
      setIsAddingTransaction(false);
      toast({
        title: "Success",
        description: "Transaction added successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add transaction",
        variant: "destructive",
      });
    },
  });

  // Calculate current balance
  const currentBalance = transactions.reduce((balance, transaction) => {
    const amount = parseFloat(transaction.total);
    if (transaction.transactionType === "payment" || transaction.transactionType === "refund") {
      return balance - amount;
    } else {
      return balance + amount;
    }
  }, 0);

  const handleAddTransaction = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const amount = parseFloat(formData.get("amount") as string);
    const gst = parseFloat(formData.get("gst") as string) || 0;
    const pst = parseFloat(formData.get("pst") as string) || 0;
    const total = amount + gst + pst;

    const transaction = {
      date: formData.get("date") as string,
      description: formData.get("description") as string,
      amount: amount.toFixed(2),
      gst: gst.toFixed(2),
      pst: pst.toFixed(2),
      total: total.toFixed(2),
      transactionType: formData.get("transactionType") as "payment" | "charge" | "refund" | "adjustment",
      paymentMethod: formData.get("paymentMethod") as string,
      referenceNumber: formData.get("referenceNumber") as string,
      notes: formData.get("notes") as string,
    };

    addTransactionMutation.mutate(transaction);
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case "payment":
        return <CreditCard className="h-4 w-4" />;
      case "charge":
        return <Receipt className="h-4 w-4" />;
      case "refund":
        return <Banknote className="h-4 w-4" />;
      default:
        return <Receipt className="h-4 w-4" />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case "payment":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
      case "charge":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
      case "refund":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
      case "adjustment":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
    }
  };

  if (isLoading) {
    return <div>Loading transactions...</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-2xl font-bold">Statement of Account</CardTitle>
          <Dialog open={isAddingTransaction} onOpenChange={setIsAddingTransaction}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Transaction
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add New Transaction</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleAddTransaction} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      name="date"
                      type="date"
                      required
                      defaultValue={format(new Date(), "yyyy-MM-dd")}
                    />
                  </div>
                  <div>
                    <Label htmlFor="transactionType">Transaction Type</Label>
                    <Select name="transactionType" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="charge">Charge</SelectItem>
                        <SelectItem value="payment">Payment</SelectItem>
                        <SelectItem value="refund">Refund</SelectItem>
                        <SelectItem value="adjustment">Adjustment</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    name="description"
                    placeholder="Enter transaction description"
                    required
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="amount">Amount</Label>
                    <Input
                      id="amount"
                      name="amount"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="gst">GST</Label>
                    <Input
                      id="gst"
                      name="gst"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="pst">PST</Label>
                    <Input
                      id="pst"
                      name="pst"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="paymentMethod">Payment Method</Label>
                    <Select name="paymentMethod">
                      <SelectTrigger>
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="credit">Credit Card</SelectItem>
                        <SelectItem value="debit">Debit Card</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="e-transfer">E-Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="referenceNumber">Reference Number</Label>
                    <Input
                      id="referenceNumber"
                      name="referenceNumber"
                      placeholder="Enter reference number"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    name="notes"
                    placeholder="Additional notes (optional)"
                  />
                </div>

                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setIsAddingTransaction(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={addTransactionMutation.isPending}>
                    {addTransactionMutation.isPending ? "Adding..." : "Add Transaction"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-lg font-semibold">Current Balance:</span>
              <span className={`text-2xl font-bold ${currentBalance >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                ${Math.abs(currentBalance).toFixed(2)} {currentBalance >= 0 ? 'Owing' : 'Credit'}
              </span>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>GST</TableHead>
                <TableHead>PST</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Method</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>{format(new Date(transaction.date), "MMM d, yyyy")}</TableCell>
                  <TableCell className="font-medium">{transaction.description}</TableCell>
                  <TableCell>
                    <Badge className={getTransactionColor(transaction.transactionType)}>
                      <div className="flex items-center gap-1">
                        {getTransactionIcon(transaction.transactionType)}
                        {transaction.transactionType.charAt(0).toUpperCase() + transaction.transactionType.slice(1)}
                      </div>
                    </Badge>
                  </TableCell>
                  <TableCell>${parseFloat(transaction.amount).toFixed(2)}</TableCell>
                  <TableCell>${parseFloat(transaction.gst).toFixed(2)}</TableCell>
                  <TableCell>${parseFloat(transaction.pst).toFixed(2)}</TableCell>
                  <TableCell className="font-semibold">
                    ${parseFloat(transaction.total).toFixed(2)}
                  </TableCell>
                  <TableCell className="capitalize">
                    {transaction.paymentMethod || "N/A"}
                  </TableCell>
                </TableRow>
              ))}
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-gray-500 dark:text-gray-400 py-8">
                    No transactions found. Click "Add Transaction" to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}