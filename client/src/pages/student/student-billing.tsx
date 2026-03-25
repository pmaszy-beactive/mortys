import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  CreditCard, 
  DollarSign, 
  Download, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle,
  Package,
  Receipt,
  User,
  Users,
  LogOut
} from "lucide-react";
import { useLocation, Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useToast } from "@/hooks/use-toast";
import { CardElement, useStripe, useElements, Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

const stripePublicKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise = stripePublicKey ? loadStripe(stripePublicKey) : null;

interface PaymentMethod {
  id: number;
  cardBrand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
}

interface LessonPackage {
  id: number;
  name: string;
  description: string | null;
  courseType: string;
  lessonCount: number;
  price: string;
  isActive: boolean;
}

interface Transaction {
  id: number | string;
  date: string;
  description: string | null;
  amount: string;
  total: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  paidBy?: string;
  payerName?: string;
  payerRelationship?: string;
  type?: string;
  linkedTo?: {
    id: number;
    description: string;
    originalAmount: string;
    date: string;
  } | null;
  coveredItems?: string | null;
}

interface BillingOverview {
  outstandingBalance: number;
  unpaidInvoices: number;
  packages: LessonPackage[];
  creditBalance: number;
  totalPaid: number;
  studentPayments: number;
  otherPayments: number;
}

function BillingContent() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();
  const stripe = useStripe();
  const elements = useElements();
  
  const [addCardOpen, setAddCardOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<LessonPackage | null>(null);

  const { data: overview, isLoading: overviewLoading } = useQuery<BillingOverview>({
    queryKey: ["/api/student/billing/overview"],
    enabled: isAuthenticated,
  });

  const { data: paymentMethods = [], isLoading: methodsLoading } = useQuery<PaymentMethod[]>({
    queryKey: ["/api/student/billing/methods"],
    enabled: isAuthenticated,
  });

  const { data: transactions = [], isLoading: historyLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/student/billing/history"],
    enabled: isAuthenticated,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      setLocation("/student-login");
    },
  });

  const addCardMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      return await apiRequest("POST", "/api/student/billing/methods/add", { paymentMethodId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/billing/methods"] });
      toast({
        title: "Card added successfully",
        description: "Your payment method has been saved.",
      });
      setAddCardOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to add card",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (methodId: number) => {
      return await apiRequest("DELETE", `/api/student/billing/methods/${methodId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/billing/methods"] });
      toast({
        title: "Card removed",
        description: "Payment method has been deleted.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove card",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (methodId: number) => {
      return await apiRequest("POST", "/api/student/billing/methods/default", { methodId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/billing/methods"] });
      toast({
        title: "Default payment method updated",
      });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (data: { type: string; packageId?: number; amount?: number; paymentMethodId: number; description?: string }) => {
      return await apiRequest("POST", "/api/student/billing/checkout", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/billing/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student/billing/history"] });
      toast({
        title: "Payment successful!",
        description: "Your purchase has been completed.",
      });
      setSelectedPackage(null);
    },
    onError: (error: any) => {
      toast({
        title: "Payment failed",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAddCard = async () => {
    if (!stripe || !elements) {
      toast({
        title: "Stripe not initialized",
        description: "Please refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    const { error, paymentMethod } = await stripe.createPaymentMethod({
      type: "card",
      card: cardElement,
    });

    if (error) {
      toast({
        title: "Card validation failed",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    addCardMutation.mutate(paymentMethod.id);
  };

  const handlePurchasePackage = (pkg: LessonPackage) => {
    const defaultMethod = paymentMethods.find(m => m.isDefault);
    if (!defaultMethod) {
      toast({
        title: "No payment method",
        description: "Please add a payment method first.",
        variant: "destructive",
      });
      return;
    }

    checkoutMutation.mutate({
      type: "package",
      packageId: pkg.id,
      paymentMethodId: defaultMethod.id,
    });
  };

  const handlePayBalance = () => {
    const defaultMethod = paymentMethods.find(m => m.isDefault);
    if (!defaultMethod || !overview) {
      toast({
        title: "Cannot process payment",
        description: "Please add a payment method first.",
        variant: "destructive",
      });
      return;
    }

    checkoutMutation.mutate({
      type: "balance",
      amount: overview.outstandingBalance,
      paymentMethodId: defaultMethod.id,
      description: "Outstanding balance payment",
    });
  };

  if (!authLoading && !isAuthenticated) {
    setLocation("/student/login");
    return null;
  }

  if (authLoading || overviewLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading billing information...</p>
        </div>
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-900">Checkout & Balances</h1>
            <div className="flex gap-2">
              <Link href="/student/classes">
                <Button variant="outline" className="border-gray-200">
                  Back to Dashboard
                </Button>
              </Link>
            </div>
          </div>
        </div>
        <Alert className="bg-amber-50 border-amber-200 text-amber-800">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Payment system is not configured. Please contact your administrator to set up Stripe payment processing.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Checkout & Balances
            </h1>
            <p className="text-sm text-gray-600">
              Manage payments, packages, and billing history
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/student/classes">
              <Button variant="outline" size="sm" className="border-gray-200 text-gray-700" data-testid="button-dashboard">
                Dashboard
              </Button>
            </Link>
            <Link href="/student/profile">
              <Button variant="outline" size="sm" className="border-gray-200 text-gray-700" data-testid="button-profile">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-8">
        {/* Balance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="stat-card">
            <CardContent className="p-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Outstanding Balance</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1" data-testid="text-balance">
                    ${overview?.outstandingBalance.toFixed(2) || "0.00"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                  <DollarSign className="h-8 w-8 text-gray-400" />
                </div>
              </div>
              {overview && overview.outstandingBalance > 0 && (
                <Button 
                  onClick={handlePayBalance}
                  disabled={checkoutMutation.isPending || paymentMethods.length === 0}
                  className="w-full mt-6 bg-[#ECC462] hover:bg-[#d4af56] text-[#111111] shadow-none font-semibold"
                  data-testid="button-pay-balance"
                >
                  Pay Balance Now
                </Button>
              )}
            </CardContent>
          </Card>

          <Card className="stat-card border-l-green-500">
            <CardContent className="p-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Paid</p>
                  <p className="text-3xl font-bold text-green-600 mt-1" data-testid="text-total-paid">
                    ${overview?.totalPaid?.toFixed(2) || "0.00"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {overview && (overview.studentPayments > 0 || overview.otherPayments > 0) && (
                      <p className="text-xs text-gray-500 flex items-center gap-1">
                        Includes family contributions
                      </p>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                  <Check className="h-8 w-8 text-green-500/50" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="stat-card border-l-blue-500">
            <CardContent className="p-0">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Payment Methods</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1" data-testid="text-methods">
                    {paymentMethods.length}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                  <CreditCard className="h-8 w-8 text-blue-500/50" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payment Methods */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-gray-900">Payment Methods</CardTitle>
              <CardDescription>Manage your saved cards</CardDescription>
            </div>
            <Dialog open={addCardOpen} onOpenChange={setAddCardOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-gray-200 rounded-md" data-testid="button-add-card">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Card
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Payment Method</DialogTitle>
                  <DialogDescription>
                    Add a new credit or debit card for payments
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="p-4 border border-gray-200 rounded-md">
                    <CardElement
                      options={{
                        style: {
                          base: {
                            fontSize: '16px',
                            color: '#111111',
                            '::placeholder': {
                              color: '#aab7c4',
                            },
                          },
                        },
                      }}
                    />
                  </div>
                  <Button 
                    onClick={handleAddCard}
                    disabled={addCardMutation.isPending || !stripe}
                    className="w-full bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] shadow-none font-semibold"
                    data-testid="button-save-card"
                  >
                    {addCardMutation.isPending ? "Saving..." : "Save Card"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {methodsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : paymentMethods.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <CreditCard className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No payment methods saved</p>
              </div>
            ) : (
              <div className="space-y-3">
                {paymentMethods.map((method) => (
                  <div
                    key={method.id}
                    className="flex items-center justify-between p-4 border border-gray-100 rounded-md hover:bg-gray-50 transition-colors"
                    data-testid={`card-method-${method.id}`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="bg-gray-100 p-2 rounded-md">
                        <CreditCard className="h-6 w-6 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {method.cardBrand?.toUpperCase()} •••• {method.last4}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <p className="text-sm text-gray-500">
                            Expires {method.expiryMonth}/{method.expiryYear}
                          </p>
                          {method.isDefault && (
                            <Badge className="bg-[#ECC462]/10 text-[#111111] border-[#ECC462]/30 text-[10px] uppercase tracking-wider h-5 px-1.5 font-bold rounded-sm">Default</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!method.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefaultMutation.mutate(method.id)}
                          disabled={setDefaultMutation.isPending}
                          data-testid={`button-set-default-${method.id}`}
                          className="h-8 w-8 p-0"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteCardMutation.mutate(method.id)}
                        disabled={deleteCardMutation.isPending}
                        data-testid={`button-delete-${method.id}`}
                        className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment History */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-gray-900">Payment History</CardTitle>
            <CardDescription>View all transactions including payments from parents/guardians</CardDescription>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Receipt className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>No payment history found</p>
              </div>
            ) : (
              <div className="rounded-md border border-gray-100 overflow-hidden">
                <Table>
                  <TableHeader className="bg-gray-50/50">
                    <TableRow>
                      <TableHead className="font-semibold text-gray-700">Date</TableHead>
                      <TableHead className="font-semibold text-gray-700">Description</TableHead>
                      <TableHead className="font-semibold text-gray-700">Paid By</TableHead>
                      <TableHead className="font-semibold text-gray-700">Method</TableHead>
                      <TableHead className="text-right font-semibold text-gray-700">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transactions.map((tx) => (
                      <TableRow key={tx.id} data-testid={`row-transaction-${tx.id}`} className="hover:bg-gray-50 transition-colors">
                        <TableCell className="text-gray-600">{tx.date}</TableCell>
                        <TableCell>
                          <div className="space-y-0.5">
                            <p className="font-medium text-gray-900">{tx.description}</p>
                            {tx.coveredItems && (
                              <p className="text-xs text-gray-500">
                                {tx.coveredItems}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {tx.paidBy === 'other' ? (
                            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-100 rounded-sm">
                              <Users className="h-3 w-3 mr-1" />
                              {tx.payerName || 'Parent'}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 rounded-sm">
                              <User className="h-3 w-3 mr-1" />
                              You
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-gray-600 text-sm">{tx.paymentMethod || "N/A"}</span>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-gray-900">
                          ${parseFloat(tx.total).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StripeNotConfigured() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading, isAuthenticated } = useStudentAuth();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      toast({
        title: "Logged out successfully",
        description: "You have been logged out of your account.",
      });
      setLocation("/student-login");
    },
  });

  if (!authLoading && !isAuthenticated) {
    setLocation("/student/login");
    return null;
  }

  if (authLoading) {
    return (
      <div className="h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-[#ECC462] mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50">
      <div className="bg-white/80 backdrop-blur-lg shadow-lg border-b border-[#ECC462]/20">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold text-[#111111]">Checkout & Balances</h1>
            <div className="flex gap-2">
              <Link href="/student/classes">
                <Button variant="outline" className="border-[#ECC462]">
                  Back to Dashboard
                </Button>
              </Link>
              <Button 
                variant="outline"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Payment system is not configured. Please contact your administrator to set up Stripe payment processing.
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

export default function StudentBilling() {
  if (!stripePromise) {
    return <StripeNotConfigured />;
  }

  return (
    <Elements stripe={stripePromise}>
      <BillingContent />
    </Elements>
  );
}
