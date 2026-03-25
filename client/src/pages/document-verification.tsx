import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { 
  FileText, Search, CheckCircle2, XCircle, Clock, Eye, 
  Loader2, AlertTriangle, User, Pencil, FolderOpen, Calendar, Save,
  HelpCircle, ArrowRight, Upload, ShieldCheck, FileX, Info
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { Student, StudentDocument } from "@shared/schema";
import { format, parse, isValid, isBefore, addDays } from "date-fns";

interface DocumentWithStudent extends StudentDocument {
  student?: Student;
}

export default function DocumentVerification() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedDoc, setSelectedDoc] = useState<DocumentWithStudent | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentWithStudent | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const { toast } = useToast();

  const { data: studentsResponse } = useQuery<{ students: Student[] }>({
    queryKey: ["/api/students"],
  });
  const students = studentsResponse?.students || [];

  const { data: allDocuments = [], isLoading } = useQuery<StudentDocument[]>({
    queryKey: ["/api/student-documents/all", statusFilter, typeFilter],
    queryFn: async () => {
      const allDocs: StudentDocument[] = [];
      for (const student of students) {
        const response = await fetch(`/api/students/${student.id}/documents`, { credentials: 'include' });
        if (response.ok) {
          const docs = await response.json();
          docs.forEach((doc: StudentDocument) => {
            (doc as DocumentWithStudent).student = student;
          });
          allDocs.push(...docs);
        }
      }
      return allDocs;
    },
    enabled: students.length > 0,
  });

  const verifyMutation = useMutation({
    mutationFn: async ({ docId, status, reason }: { docId: number; status: string; reason?: string }) => {
      const response = await fetch(`/api/student-documents/${docId}/verify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          verificationStatus: status, 
          rejectionReason: reason 
        }),
      });
      if (!response.ok) throw new Error('Verification failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-documents/all"] });
      toast({ title: "Document updated", description: "Document verification status has been updated." });
      setSelectedDoc(null);
      setRejectionReason("");
    },
    onError: () => {
      toast({ title: "Update failed", description: "Failed to update document status.", variant: "destructive" });
    },
  });

  const updateMetadataMutation = useMutation({
    mutationFn: async ({ docId, folderName, expiryDate, notes }: { 
      docId: number; 
      folderName?: string; 
      expiryDate?: string; 
      notes?: string 
    }) => {
      const response = await fetch(`/api/student-documents/${docId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ folderName, expiryDate, notes }),
      });
      if (!response.ok) throw new Error('Update failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student-documents/all"] });
      toast({ title: "Metadata updated", description: "Document metadata has been saved." });
      setEditingDoc(null);
    },
    onError: () => {
      toast({ title: "Update failed", description: "Failed to update document metadata.", variant: "destructive" });
    },
  });

  const handleApprove = async (doc: DocumentWithStudent) => {
    setIsVerifying(true);
    try {
      await verifyMutation.mutateAsync({ docId: doc.id, status: 'approved' });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleReject = async () => {
    if (!selectedDoc) return;
    if (!rejectionReason.trim()) {
      toast({ title: "Reason required", description: "Please provide a reason for rejection.", variant: "destructive" });
      return;
    }
    setIsVerifying(true);
    try {
      await verifyMutation.mutateAsync({ docId: selectedDoc.id, status: 'rejected', reason: rejectionReason });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleEditDocument = (doc: DocumentWithStudent) => {
    setEditingDoc(doc);
    setEditFolderName(doc.folderName || "");
    setEditExpiryDate(doc.expiryDate || "");
    setEditNotes(doc.notes || "");
  };

  const handleSaveMetadata = async () => {
    if (!editingDoc) return;
    await updateMetadataMutation.mutateAsync({
      docId: editingDoc.id,
      folderName: editFolderName,
      expiryDate: editExpiryDate,
      notes: editNotes,
    });
  };

  const filteredDocuments = (allDocuments as DocumentWithStudent[]).filter(doc => {
    if (statusFilter !== 'all' && doc.verificationStatus !== statusFilter) return false;
    if (typeFilter !== 'all' && doc.documentType !== typeFilter) return false;
    if (searchQuery) {
      const search = searchQuery.toLowerCase();
      const studentName = doc.student ? `${doc.student.firstName} ${doc.student.lastName}`.toLowerCase() : '';
      const folderName = (doc.folderName || '').toLowerCase();
      if (!studentName.includes(search) && !doc.documentName.toLowerCase().includes(search) && !folderName.includes(search)) {
        return false;
      }
    }
    return true;
  });

  const getStatusBadge = (status: string | null, showTooltip: boolean = true) => {
    const statusConfig = {
      approved: {
        badge: <Badge className="bg-green-100 text-green-800 border border-green-200"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>,
        tooltip: "This document has been verified and approved. The student can proceed with enrollment."
      },
      rejected: {
        badge: <Badge className="bg-red-100 text-red-800 border border-red-200"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>,
        tooltip: "This document was rejected and needs to be resubmitted by the student. Check rejection reason for details."
      },
      pending: {
        badge: <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pending Review</Badge>,
        tooltip: "This document is awaiting staff review. Click to view and verify."
      }
    };
    
    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    
    if (!showTooltip) return config.badge;
    
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{config.badge}</span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-sm">{config.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const getExpiryBadge = (expiryDate: string | null | undefined) => {
    if (!expiryDate) return null;
    try {
      const expiry = parse(expiryDate, 'yyyy-MM-dd', new Date());
      if (!isValid(expiry)) return null;
      const today = new Date();
      const warningDate = addDays(today, 30);
      
      const expiryConfig = {
        expired: {
          badge: <Badge className="bg-red-100 text-red-800 border border-red-200">Expired</Badge>,
          tooltip: `This document expired on ${format(expiry, 'MMM d, yyyy')}. Student must provide an updated document.`
        },
        expiring: {
          badge: <Badge className="bg-orange-100 text-orange-800 border border-orange-200">Expiring Soon</Badge>,
          tooltip: `This document expires on ${format(expiry, 'MMM d, yyyy')}. Remind student to renew.`
        },
        valid: {
          badge: <Badge className="bg-green-100 text-green-800 border border-green-200">Valid</Badge>,
          tooltip: `Document valid until ${format(expiry, 'MMM d, yyyy')}.`
        }
      };
      
      let config;
      if (isBefore(expiry, today)) {
        config = expiryConfig.expired;
      } else if (isBefore(expiry, warningDate)) {
        config = expiryConfig.expiring;
      } else {
        config = expiryConfig.valid;
      }
      
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">{config.badge}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-sm">{config.tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    } catch {
      return null;
    }
  };

  const documentTypeLabels: Record<string, string> = {
    photo_id: "Photo ID",
    permit: "Learner's Permit",
    medical_certificate: "Medical Certificate",
    consent_form: "Consent Form",
    certificate: "Certificate",
    photo: "Photo",
    contract: "Contract",
    other: "Other",
  };

  const pendingCount = allDocuments.filter(d => d.verificationStatus === 'pending' || !d.verificationStatus).length;
  const expiringCount = allDocuments.filter(d => {
    if (!d.expiryDate) return false;
    try {
      const expiry = parse(d.expiryDate, 'yyyy-MM-dd', new Date());
      return isValid(expiry) && isBefore(expiry, addDays(new Date(), 30));
    } catch { return false; }
  }).length;

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">
                Document Verification
              </h1>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <HelpCircle className="h-5 w-5 text-gray-400 hover:text-[#ECC462]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-sm p-4">
                    <div className="space-y-2">
                      <p className="font-semibold">What is Document Verification?</p>
                      <p className="text-sm text-gray-600">
                        Document verification ensures that all student-submitted documents 
                        (IDs, permits, certificates) are authentic, legible, and meet 
                        regulatory requirements before enrollment is finalized.
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="text-gray-600 text-lg">
              Review and verify student-uploaded documents. Manage metadata including folder names and expiry dates.
            </p>
          </div>
        </div>

        <Card className="border-[#ECC462]/30 bg-gradient-to-r from-amber-50/50 to-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="h-5 w-5 text-[#ECC462]" />
              Verification Workflow
            </CardTitle>
            <CardDescription>
              Follow this process to verify student documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4">
              <div className="flex flex-col items-center text-center p-3 bg-white rounded-lg shadow-sm border min-w-[120px]">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center mb-2">
                  <Upload className="h-5 w-5 text-blue-600" />
                </div>
                <span className="text-sm font-medium">1. Upload</span>
                <span className="text-xs text-gray-500">Student submits</span>
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 hidden md:block" />
              <div className="flex flex-col items-center text-center p-3 bg-white rounded-lg shadow-sm border min-w-[120px]">
                <div className="h-10 w-10 rounded-full bg-yellow-100 flex items-center justify-center mb-2">
                  <Clock className="h-5 w-5 text-yellow-600" />
                </div>
                <span className="text-sm font-medium">2. Pending</span>
                <span className="text-xs text-gray-500">Awaits review</span>
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 hidden md:block" />
              <div className="flex flex-col items-center text-center p-3 bg-white rounded-lg shadow-sm border min-w-[120px]">
                <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center mb-2">
                  <Eye className="h-5 w-5 text-purple-600" />
                </div>
                <span className="text-sm font-medium">3. Review</span>
                <span className="text-xs text-gray-500">Staff examines</span>
              </div>
              <ArrowRight className="h-5 w-5 text-gray-300 hidden md:block" />
              <div className="flex flex-col items-center text-center p-3 bg-white rounded-lg shadow-sm border min-w-[120px]">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center mb-2">
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                </div>
                <span className="text-sm font-medium">4a. Approve</span>
                <span className="text-xs text-gray-500">Document valid</span>
              </div>
              <span className="text-gray-400 hidden md:block">or</span>
              <div className="flex flex-col items-center text-center p-3 bg-white rounded-lg shadow-sm border min-w-[120px]">
                <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center mb-2">
                  <FileX className="h-5 w-5 text-red-600" />
                </div>
                <span className="text-sm font-medium">4b. Reject</span>
                <span className="text-xs text-gray-500">Needs resubmit</span>
              </div>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                <strong>Staff responsibilities:</strong> Check document authenticity, verify information matches student records, 
                ensure documents are legible and not expired, and provide clear rejection reasons if needed.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingCount > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600" />
              <p className="text-yellow-800 font-medium">
                {pendingCount} document{pendingCount !== 1 ? 's' : ''} pending verification
              </p>
            </div>
          )}
          {expiringCount > 0 && (
            <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-3">
              <Calendar className="h-5 w-5 text-orange-600" />
              <p className="text-orange-800 font-medium">
                {expiringCount} document{expiringCount !== 1 ? 's' : ''} expiring within 30 days
              </p>
            </div>
          )}
        </div>

        <Card className="border-0 shadow-xl bg-white/80 backdrop-blur-sm">
          <CardHeader className="bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-amber-100">
            <CardTitle className="text-xl font-semibold text-gray-800">All Documents</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="space-y-2">
                <Label>Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Student, document, or folder name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-doc-search"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger data-testid="select-doc-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger data-testid="select-doc-type-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="photo_id">Photo ID</SelectItem>
                    <SelectItem value="permit">Learner's Permit</SelectItem>
                    <SelectItem value="medical_certificate">Medical Certificate</SelectItem>
                    <SelectItem value="consent_form">Consent Form</SelectItem>
                    <SelectItem value="certificate">Certificate</SelectItem>
                    <SelectItem value="photo">Photo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isLoading ? (
              <div className="text-center py-12">
                <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#ECC462]" />
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <FileText className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                <p className="text-lg font-medium">No documents found</p>
                <p className="text-sm">Adjust your filters or wait for student uploads</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Document</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Nom de Dossier</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead>Upload Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.map((doc) => (
                      <TableRow key={doc.id} className="hover:bg-amber-50/50">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-gray-500" />
                            <span className="font-medium">
                              {doc.student ? `${doc.student.firstName} ${doc.student.lastName}` : 'Unknown'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-gray-500" />
                            {doc.documentName}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="bg-gray-50">
                            {documentTypeLabels[doc.documentType] || doc.documentType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {doc.folderName ? (
                            <div className="flex items-center gap-1 text-sm">
                              <FolderOpen className="h-3 w-3 text-amber-600" />
                              <span>{doc.folderName}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-sm">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {doc.expiryDate ? (
                              <>
                                <span className="text-sm">{doc.expiryDate}</span>
                                {getExpiryBadge(doc.expiryDate)}
                              </>
                            ) : (
                              <span className="text-gray-400 text-sm">-</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-600">{doc.uploadDate}</TableCell>
                        <TableCell>{getStatusBadge(doc.verificationStatus)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditDocument(doc)}
                              title="Edit Metadata"
                              data-testid={`button-edit-doc-${doc.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {doc.id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  window.open(`/api/student-documents/${doc.id}/file`, '_blank');
                                }}
                                title="View Document"
                                data-testid={`button-view-doc-${doc.id}`}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                            {(!doc.verificationStatus || doc.verificationStatus === 'pending') && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                  onClick={() => handleApprove(doc)}
                                  disabled={isVerifying}
                                  title="Approve"
                                  data-testid={`button-approve-doc-${doc.id}`}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => setSelectedDoc(doc)}
                                  disabled={isVerifying}
                                  title="Reject"
                                  data-testid={`button-reject-doc-${doc.id}`}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Edit Metadata Dialog */}
        <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[#ECC462]" />
                Edit Document Metadata
              </DialogTitle>
              <DialogDescription>
                Update folder name, expiry date, and notes for this document.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="p-4 bg-gray-50 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium">
                    {editingDoc?.student ? `${editingDoc.student.firstName} ${editingDoc.student.lastName}` : 'Unknown Student'}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  <strong>Document:</strong> {editingDoc?.documentName}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Type:</strong> {editingDoc?.documentType ? documentTypeLabels[editingDoc.documentType] : 'Unknown'}
                </p>
              </div>
              
              <Tabs defaultValue="metadata" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                </TabsList>
                <TabsContent value="metadata" className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="folderName" className="flex items-center gap-2">
                      <FolderOpen className="h-4 w-4 text-amber-600" />
                      Nom de Dossier (Folder Name)
                    </Label>
                    <Input
                      id="folderName"
                      value={editFolderName}
                      onChange={(e) => setEditFolderName(e.target.value)}
                      placeholder="e.g., Student-2025-001 or Archive-Q1"
                      data-testid="input-folder-name"
                    />
                    <p className="text-xs text-gray-500">
                      Use this to organize documents into logical folders/categories
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expiryDate" className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-amber-600" />
                      Expiry Date
                    </Label>
                    <Input
                      id="expiryDate"
                      type="date"
                      value={editExpiryDate}
                      onChange={(e) => setEditExpiryDate(e.target.value)}
                      data-testid="input-expiry-date"
                    />
                    <p className="text-xs text-gray-500">
                      Set the expiration date for permits, certificates, or ID documents
                    </p>
                  </div>
                </TabsContent>
                <TabsContent value="notes" className="pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="docNotes">Admin Notes</Label>
                    <Textarea
                      id="docNotes"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Add any notes about this document..."
                      rows={5}
                      data-testid="textarea-doc-notes"
                    />
                    <p className="text-xs text-gray-500">
                      Internal notes visible only to administrators
                    </p>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingDoc(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveMetadata}
                disabled={updateMetadataMutation.isPending}
                className="bg-[#ECC462] hover:bg-[#d4b058] text-black"
                data-testid="button-save-metadata"
              >
                {updateMetadataMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" />Save Changes</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject Document Dialog */}
        <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Document</DialogTitle>
              <DialogDescription>
                Please provide a reason for rejecting this document. The student will be notified.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600">
                  <strong>Document:</strong> {selectedDoc?.documentName}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Type:</strong> {selectedDoc?.documentType ? documentTypeLabels[selectedDoc.documentType] : 'Unknown'}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Rejection Reason</Label>
                <Textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Please specify why this document is being rejected..."
                  rows={4}
                  data-testid="textarea-rejection-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedDoc(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={isVerifying || !rejectionReason.trim()}
                data-testid="button-confirm-reject"
              >
                {isVerifying ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rejecting...</>
                ) : (
                  'Reject Document'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
