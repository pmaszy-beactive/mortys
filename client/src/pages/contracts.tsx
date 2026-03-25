import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Eye, Download, Check, FileSignature, Hourglass, CheckCircle, Clock, FileText, DollarSign, Sparkles, TrendingUp } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import ContractForm from "@/components/contract-form";
import { formatCurrency, formatDate, getStatusColor, generateAttestationNumber } from "@/lib/utils";
import type { Contract, Student } from "@shared/schema";

export default function Contracts() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const { toast } = useToast();

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const { data: students = [] } = useQuery<Student[]>({
    queryKey: ["/api/students"],
  });

  const generateAttestationMutation = useMutation({
    mutationFn: (contractId: number) => {
      const attestationNumber = generateAttestationNumber();
      return apiRequest("PUT", `/api/contracts/${contractId}`, {
        attestationGenerated: true,
        attestationNumber
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({
        title: "Success",
        description: "Attestation generated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error", 
        description: "Failed to generate attestation",
        variant: "destructive",
      });
    },
  });

  const approveContractMutation = useMutation({
    mutationFn: (contractId: number) => 
      apiRequest("PUT", `/api/contracts/${contractId}`, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Success",
        description: "Contract approved successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to approve contract",
        variant: "destructive",
      });
    },
  });

  const getStudentName = (studentId: number) => {
    const student = students.find(s => s.id === studentId);
    return student ? `${student.firstName} ${student.lastName}` : "Unknown Student";
  };

  const getStudentEmail = (studentId: number) => {
    const student = students.find(s => s.id === studentId);
    return student?.email || "";
  };

  const filteredContracts = contracts.filter(contract =>
    statusFilter === "all" || contract.status === statusFilter
  );

  const contractStats = {
    pending: contracts.filter(c => c.status === "pending").length,
    active: contracts.filter(c => c.status === "active").length,
    attestationsDue: contracts.filter(c => c.status === "active" && !c.attestationGenerated).length,
    totalRevenue: contracts.reduce((sum, c) => sum + (c.amount || 0), 0),
  };

  const getCourseColor = (courseType: string) => {
    switch (courseType) {
      case "auto": return "text-gray-600 border-gray-200";
      case "moto": return "text-gray-600 border-gray-200";
      case "scooter": return "text-gray-600 border-gray-200";
      default: return "text-gray-600 border-gray-200";
    }
  };

  const getEnhancedStatusColor = (status: string) => {
    switch (status) {
      case "pending": return "bg-amber-100 text-amber-700 border-amber-200";
      case "active": return "bg-green-100 text-green-700 border-green-200";
      case "completed": return "bg-blue-100 text-blue-700 border-blue-200";
      default: return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="animate-pulse space-y-8">
            <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-40 bg-white border border-gray-200 rounded-md"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="mb-10">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-xl font-semibold text-gray-900">
                  Contracts & Attestations
                </h1>
                <FileText className="h-6 w-6 text-[#ECC462]" />
              </div>
              <p className="text-gray-600 font-medium">
                Create and manage student contracts and government attestations.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium rounded-md transition-all duration-200">
                  <Plus className="mr-2 h-4 w-4" />
                  New Contract
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Create New Contract</DialogTitle>
                  <DialogDescription>
                    Create a new student contract with course and payment details.
                  </DialogDescription>
                </DialogHeader>
                <ContractForm onSuccess={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Contract Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <Hourglass className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Pending
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Pending Contracts</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{contractStats.pending}</p>
              <p className="text-gray-400 text-xs">awaiting approval</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <CheckCircle className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Active
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Active Contracts</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{contractStats.active}</p>
              <p className="text-gray-400 text-xs">currently running</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <FileSignature className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Due
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Attestations Due</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{contractStats.attestationsDue}</p>
              <p className="text-gray-400 text-xs">need generation</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <Badge variant="outline" className="text-gray-600 border-gray-200">
                Total
              </Badge>
            </div>
            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-1">Total Revenue</p>
              <p className="text-3xl font-bold text-gray-900 mb-1">{formatCurrency(contractStats.totalRevenue)}</p>
              <p className="text-gray-400 text-xs">from all contracts</p>
            </div>
          </div>
        </div>

        {/* Contract Management */}
        <Card className="mb-8 bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="border-b bg-gray-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-semibold text-gray-900 flex items-center">
                  <FileText className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Contract Management
                </CardTitle>
                <CardDescription className="mt-1 text-gray-600">View and manage all student contracts</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48 bg-white border-gray-200 rounded-md">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50">
                    <TableHead className="font-semibold text-gray-700">Student</TableHead>
                    <TableHead className="font-semibold text-gray-700">Course</TableHead>
                    <TableHead className="font-semibold text-gray-700">Contract Date</TableHead>
                    <TableHead className="font-semibold text-gray-700">Amount</TableHead>
                    <TableHead className="font-semibold text-gray-700">Status</TableHead>
                    <TableHead className="font-semibold text-gray-700">Attestation</TableHead>
                    <TableHead className="font-semibold text-gray-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredContracts.map((contract) => (
                    <TableRow 
                      key={contract.id}
                      className="hover:bg-gray-50 transition-colors duration-200"
                    >
                      <TableCell>
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            {getStudentName(contract.studentId!)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {getStudentEmail(contract.studentId!)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getCourseColor(contract.courseType)}>
                          {contract.courseType.charAt(0).toUpperCase() + contract.courseType.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-gray-700">
                        {formatDate(contract.contractDate)}
                      </TableCell>
                      <TableCell className="text-sm font-semibold text-gray-900">
                        {formatCurrency(contract.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getEnhancedStatusColor(contract.status)}>
                          {contract.status.charAt(0).toUpperCase() + contract.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {contract.attestationGenerated ? (
                          <div className="flex items-center">
                            <Check className="h-4 w-4 text-green-600 mr-2" />
                            <div>
                              <p className="text-sm font-semibold text-green-600">Generated</p>
                              <p className="text-xs text-gray-500">{contract.attestationNumber}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center">
                            <Clock className="h-4 w-4 text-gray-400 mr-2" />
                            <div>
                              <p className="text-sm text-gray-600">Pending</p>
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-8 w-8 p-0 rounded-md"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {contract.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveContractMutation.mutate(contract.id)}
                              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-md"
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          )}
                          {contract.status === "active" && !contract.attestationGenerated && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => generateAttestationMutation.mutate(contract.id)}
                              className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-md"
                            >
                              <FileSignature className="h-4 w-4" />
                            </Button>
                          )}
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-8 w-8 p-0 rounded-md"
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredContracts.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-12">
                        <div className="bg-gray-100 rounded-full p-6 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                          <FileText className="h-8 w-8 text-gray-400" />
                        </div>
                        <p className="text-lg font-semibold text-gray-900 mb-1">
                          No contracts found
                        </p>
                        <p className="text-gray-600">Create your first contract to get started.</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Quick Contract Creation Form */}
        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="border-b bg-gray-50/50 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-semibold text-gray-900 flex items-center">
                  <Plus className="mr-2 h-5 w-5 text-[#ECC462]" />
                  Quick Contract Creation
                </CardTitle>
                <CardDescription className="mt-1 text-gray-600">Create a new contract directly from this form</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ContractForm onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
              toast({
                title: "Success",
                description: "Contract created successfully from quick form",
              });
            }} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
