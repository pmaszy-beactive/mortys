import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  RotateCcw, CheckCircle2, XCircle, Clock, DollarSign, User, AlertCircle, ExternalLink
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/sidebar";

interface RefundRequest {
  id: number;
  studentId: number;
  date: string;
  description: string;
  amount: string;
  total: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  refundStatus: string;
  refundRequestNote: string | null;
  refundAdminNote: string | null;
  refundAmount: string | null;
  refundedAt: string | null;
  createdAt: string;
  studentFirstName: string;
  studentLastName: string;
  studentEmail: string;
}

function ApproveDialog({ request, onSuccess }: { request: RefundRequest; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [amount, setAmount] = useState(parseFloat(request.total).toFixed(2));
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/refund-requests/${request.id}/approve`, {
        adminNote: adminNote.trim() || undefined,
        amount: parseFloat(amount),
      });
    },
    onSuccess: () => {
      toast({ title: "Refund approved", description: "The refund has been processed." });
      setOpen(false);
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Failed to process refund", description: error.message || "Please try again.", variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        size="sm"
        className="bg-green-600 hover:bg-green-700 text-white h-7 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Approve
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Refund</DialogTitle>
            <DialogDescription>
              Approve the refund for {request.studentFirstName} {request.studentLastName}. If this payment was made via Stripe, the refund will be executed automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-gray-50 rounded-md text-sm border border-gray-100">
              <p className="font-medium text-gray-900">{request.description}</p>
              <p className="text-gray-500 text-xs mt-0.5">{request.studentFirstName} {request.studentLastName} · {request.date}</p>
              {request.refundRequestNote && (
                <p className="text-gray-600 mt-2 italic">"{request.refundRequestNote}"</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="refund-amount">Refund Amount (CAD)</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0.01"
                max={parseFloat(request.total)}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
              <p className="text-xs text-gray-500">Max: ${parseFloat(request.total).toFixed(2)}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-note">Admin Note (optional)</Label>
              <Textarea
                id="admin-note"
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Add a note visible to the student..."
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !amount || parseFloat(amount) <= 0}
              >
                {mutation.isPending ? "Processing..." : "Confirm Refund"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DenyDialog({ request, onSuccess }: { request: RefundRequest; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/refund-requests/${request.id}/deny`, {
        adminNote: adminNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Refund request denied" });
      setOpen(false);
      onSuccess();
    },
    onError: (error: any) => {
      toast({ title: "Failed to deny request", description: error.message || "Please try again.", variant: "destructive" });
    },
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="border-red-200 text-red-600 hover:bg-red-50 h-7 px-3 text-xs"
        onClick={() => setOpen(true)}
      >
        <XCircle className="h-3 w-3 mr-1" />
        Deny
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deny Refund Request</DialogTitle>
            <DialogDescription>
              This will deny the refund request. The student will see your note.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-3 bg-gray-50 rounded-md text-sm border border-gray-100">
              <p className="font-medium text-gray-900">{request.description}</p>
              <p className="text-gray-500 text-xs mt-0.5">${parseFloat(request.total).toFixed(2)} · {request.studentFirstName} {request.studentLastName}</p>
              {request.refundRequestNote && (
                <p className="text-gray-600 mt-2 italic">"{request.refundRequestNote}"</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deny-note">Reason for denial (shown to student) <span className="text-red-500">*</span></Label>
              <Textarea
                id="deny-note"
                value={adminNote}
                onChange={e => setAdminNote(e.target.value)}
                placeholder="Explain why this refund is being denied..."
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !adminNote.trim()}
              >
                {mutation.isPending ? "Processing..." : "Deny Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function RefundRequests() {
  const { toast } = useToast();

  const { data: requests = [], isLoading, refetch } = useQuery<RefundRequest[]>({
    queryKey: ["/api/admin/refund-requests"],
  });

  const pendingCount = requests.filter(r => r.refundStatus === "requested").length;

  const handleActionSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/refund-requests"] });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="p-8 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Refund Requests</h1>
            <p className="text-sm text-gray-500 mt-1">Review and process student refund requests</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-yellow-50 p-3 rounded-md">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pending Review</p>
                  <p className="text-2xl font-bold text-gray-900">{pendingCount}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-green-50 p-3 rounded-md">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Refunded</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {requests.filter(r => r.refundStatus === "refunded").length}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="bg-red-50 p-3 rounded-md">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Denied</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {requests.filter(r => r.refundStatus === "denied").length}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Pending requests first, then resolved */}
          {isLoading ? (
            <Card>
              <CardContent className="p-6 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ) : requests.length === 0 ? (
            <Card>
              <CardContent className="py-16 text-center text-gray-400">
                <RotateCcw className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No refund requests</p>
                <p className="text-sm mt-1">Student refund requests will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Pending */}
              {pendingCount > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="h-4 w-4 text-yellow-600" />
                      Pending Review
                      <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 ml-1">{pendingCount}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-gray-50/50">
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Transaction</TableHead>
                          <TableHead>Student's Reason</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.filter(r => r.refundStatus === "requested").map(req => (
                          <TableRow key={req.id} className="hover:bg-gray-50">
                            <TableCell>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{req.studentFirstName} {req.studentLastName}</p>
                                <p className="text-xs text-gray-500">{req.studentEmail}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-gray-700">{req.description}</p>
                              {req.referenceNumber && (
                                <p className="text-xs text-gray-400 font-mono truncate max-w-[160px]">{req.referenceNumber}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-gray-600 max-w-[200px]">{req.refundRequestNote || "—"}</p>
                            </TableCell>
                            <TableCell className="text-sm text-gray-500 whitespace-nowrap">{req.date}</TableCell>
                            <TableCell className="text-right font-semibold text-gray-900 whitespace-nowrap">
                              ${parseFloat(req.total).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <ApproveDialog request={req} onSuccess={handleActionSuccess} />
                                <DenyDialog request={req} onSuccess={handleActionSuccess} />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Resolved */}
              {requests.filter(r => r.refundStatus !== "requested").length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-gray-600">Resolved</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader className="bg-gray-50/50">
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Transaction</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Admin Note</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.filter(r => r.refundStatus !== "requested").map(req => (
                          <TableRow key={req.id} className="hover:bg-gray-50">
                            <TableCell>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{req.studentFirstName} {req.studentLastName}</p>
                                <p className="text-xs text-gray-500">{req.studentEmail}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-gray-700">{req.description}</p>
                            </TableCell>
                            <TableCell>
                              {req.refundStatus === "refunded" ? (
                                <Badge className="bg-green-50 text-green-700 border-green-200 text-xs gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Refunded
                                </Badge>
                              ) : (
                                <Badge className="bg-red-50 text-red-700 border-red-200 text-xs gap-1">
                                  <XCircle className="h-3 w-3" /> Denied
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">{req.refundAdminNote || "—"}</TableCell>
                            <TableCell className="text-right font-semibold text-gray-900 whitespace-nowrap">
                              {req.refundStatus === "refunded" && req.refundAmount
                                ? `$${parseFloat(req.refundAmount).toFixed(2)} refunded`
                                : `$${parseFloat(req.total).toFixed(2)}`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
