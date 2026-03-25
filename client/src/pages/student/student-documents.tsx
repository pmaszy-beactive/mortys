import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Upload, FileText, CheckCircle, Clock, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface StudentDocument {
  id: number;
  studentId: number;
  documentType: string;
  documentName: string;
  documentData: string;
  mimeType: string;
  fileSize: number;
  uploadDate: string;
  verificationStatus: 'pending' | 'approved' | 'rejected';
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export default function StudentDocuments() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: documents = [], isLoading } = useQuery<StudentDocument[]>({
    queryKey: ["/api/student/documents"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: { documentType: string; documentName: string; documentData: string; mimeType: string; fileSize: number }) => {
      return await apiRequest("POST", "/api/student/documents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/documents"] });
      toast({
        title: "Success",
        description: "Document uploaded successfully and is pending verification",
      });
      setSelectedFile(null);
      setDocumentType("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to upload document. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: number) => {
      return await apiRequest("DELETE", `/api/student/documents/${documentId}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/documents"] });
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete document. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type FIRST (priority over size)
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
      if (!allowedTypes.includes(file.type)) {
        toast({
          title: "Invalid file type",
          description: "Invalid file type. Please select a PDF or image file (JPEG, PNG)",
          variant: "destructive",
        });
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select a file smaller than 10MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !documentType) {
      toast({
        title: "Missing information",
        description: "Please select a document type and file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Data = e.target?.result as string;
      
      uploadMutation.mutate({
        documentType,
        documentName: selectedFile.name,
        documentData: base64Data,
        mimeType: selectedFile.type,
        fileSize: selectedFile.size,
      });
    };
    reader.readAsDataURL(selectedFile);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-green-500/10 text-green-700 border-green-500/20" data-testid={`badge-approved`}>
            <CheckCircle className="w-3 h-3 mr-1" />
            Approved
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-500/10 text-red-700 border-red-500/20" data-testid={`badge-rejected`}>
            <XCircle className="w-3 h-3 mr-1" />
            Rejected
          </Badge>
        );
      default:
        return (
          <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20" data-testid={`badge-pending`}>
            <Clock className="w-3 h-3 mr-1" />
            Pending Review
          </Badge>
        );
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => setLocation("/student/classes")}
            className="mb-4"
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold text-gray-900">My Documents</h1>
          <p className="text-gray-600 mt-2">Upload and manage your required documents</p>
        </div>

        {/* Upload Section */}
        <Card className="mb-8 border-2 border-dashed border-gray-300 hover:border-[#ECC462] transition-colors">
          <CardHeader className="bg-gradient-to-r from-[#ECC462]/10 to-[#111111]/5">
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-[#ECC462]" />
              Upload New Document
            </CardTitle>
            <CardDescription>
              Accepted formats: PDF, JPEG, PNG (max 10MB)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="document-type">Document Type</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger id="document-type" data-testid="select-document-type">
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drivers_license">Driver's License</SelectItem>
                  <SelectItem value="permit">Learner's Permit</SelectItem>
                  <SelectItem value="birth_certificate">Birth Certificate</SelectItem>
                  <SelectItem value="proof_of_address">Proof of Address</SelectItem>
                  <SelectItem value="insurance_card">Insurance Card</SelectItem>
                  <SelectItem value="medical_form">Medical Form</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Select File</Label>
              <input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-file-upload"
              />
              <div
                className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragging
                    ? "border-[#ECC462] bg-[#ECC462]/10"
                    : selectedFile
                      ? "border-green-400 bg-green-50"
                      : "border-gray-300 bg-gray-50"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) {
                    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
                    if (!allowedTypes.includes(file.type)) {
                      toast({
                        title: "Invalid file type",
                        description: "Invalid file type. Please select a PDF or image file (JPEG, PNG)",
                        variant: "destructive",
                      });
                      return;
                    }
                    if (file.size > 10 * 1024 * 1024) {
                      toast({
                        title: "File too large",
                        description: "Please select a file smaller than 10MB",
                        variant: "destructive",
                      });
                      return;
                    }
                    setSelectedFile(file);
                  }
                }}
              >
                {selectedFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle className="w-8 h-8 text-green-500" />
                    <p className="text-sm font-medium text-gray-900" data-testid="text-selected-file">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-gray-500">{formatFileSize(selectedFile.size)}</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1"
                    >
                      Change File
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-8 h-8 text-gray-400" />
                    <div>
                      <p className="text-sm text-gray-600">
                        Drag and drop your file here, or
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="border-[#ECC462] text-[#111111] hover:bg-[#ECC462]/10"
                      data-testid="button-browse-files"
                    >
                      Browse Files
                    </Button>
                    <p className="text-xs text-gray-400">No file selected</p>
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={handleUpload}
              disabled={!selectedFile || !documentType || uploadMutation.isPending}
              className="w-full bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/80"
              data-testid="button-upload"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload Document"}
            </Button>
          </CardContent>
        </Card>

        {/* Documents List */}
        <Card>
          <CardHeader className="bg-gradient-to-r from-[#111111] to-[#111111]/80">
            <CardTitle className="text-white flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Uploaded Documents
            </CardTitle>
            <CardDescription className="text-gray-300">
              View the status of your submitted documents
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {isLoading ? (
              <div className="text-center py-8 text-gray-500">Loading documents...</div>
            ) : documents.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No documents uploaded yet</p>
                <p className="text-sm text-gray-400 mt-2">Upload your first document to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                    data-testid={`document-${doc.id}`}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="p-3 bg-gray-100 rounded-lg">
                        <FileText className="w-6 h-6 text-gray-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900" data-testid={`text-document-name-${doc.id}`}>
                          {doc.documentName}
                        </h4>
                        <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
                          <span data-testid={`text-document-type-${doc.id}`}>
                            {doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                          </span>
                          <span>•</span>
                          <span data-testid={`text-upload-date-${doc.id}`}>
                            Uploaded {formatDate(doc.uploadDate)}
                          </span>
                          <span>•</span>
                          <span>{formatFileSize(doc.fileSize)}</span>
                        </div>
                        {doc.verificationStatus === 'rejected' && doc.rejectionReason && (
                          <p className="text-sm text-red-600 mt-2" data-testid={`text-rejection-reason-${doc.id}`}>
                            Reason: {doc.rejectionReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(doc.verificationStatus)}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(doc.id)}
                        disabled={deleteMutation.isPending}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        data-testid={`button-delete-${doc.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
