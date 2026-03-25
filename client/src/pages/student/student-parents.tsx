import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { Link, useLocation } from "wouter";
import {
  Users,
  UserPlus,
  Mail,
  Phone,
  Edit,
  Trash2,
  Shield,
  ArrowLeft,
  Loader2,
  User
} from "lucide-react";

interface Parent {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  relationship?: string;
}

interface StudentParent {
  id: number;
  studentId: number;
  parentId: number;
  permissionLevel: string;
  parent?: Parent;
}

export default function StudentParents() {
  const { toast } = useToast();
  const { student } = useStudentAuth();
  const [, setLocation] = useLocation();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedParentLink, setSelectedParentLink] = useState<StudentParent | null>(null);
  const [editingPermission, setEditingPermission] = useState<number | null>(null);

  // Form state for adding new parent
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    relationship: "",
    permissionLevel: "view_only",
  });

  // Fetch linked parents
  const { data: linkedParents = [], isLoading } = useQuery<StudentParent[]>({
    queryKey: ["/api/student/parents"],
  });

  // Add parent mutation
  const addParentMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/student/parents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/parents"] });
      setIsAddDialogOpen(false);
      setFormData({
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
        relationship: "",
        permissionLevel: "view_only",
      });
      toast({
        title: "Parent Invited",
        description: "An invitation email has been sent to the parent.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to invite parent",
        variant: "destructive",
      });
    },
  });

  // Update permission mutation
  const updatePermissionMutation = useMutation({
    mutationFn: async ({ id, permissionLevel }: { id: number; permissionLevel: string }) => {
      return await apiRequest("PATCH", `/api/student/parents/${id}`, { permissionLevel });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/parents"] });
      setEditingPermission(null);
      toast({
        title: "Permission Updated",
        description: "Parent access level has been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update permission",
        variant: "destructive",
      });
    },
  });

  // Delete parent link mutation
  const deleteParentMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiRequest("DELETE", `/api/student/parents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/student/parents"] });
      setIsDeleteDialogOpen(false);
      setSelectedParentLink(null);
      toast({
        title: "Parent Removed",
        description: "Parent access has been removed from your account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove parent",
        variant: "destructive",
      });
    },
  });

  const handleAddParent = async (e: React.FormEvent) => {
    e.preventDefault();
    addParentMutation.mutate(formData);
  };

  const handleDeleteParent = (parentLink: StudentParent) => {
    setSelectedParentLink(parentLink);
    setIsDeleteDialogOpen(true);
  };

  const getPermissionLabel = (level: string) => {
    switch (level) {
      case "view_only":
        return "View Only";
      case "view_book":
        return "View + Book Classes";
      case "view_book_pay":
        return "View + Book + Payments";
      default:
        return level;
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Link href="/student/classes">
              <Button
                variant="ghost"
                size="icon"
                className="text-gray-600 hover:text-gray-900"
                data-testid="button-back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="bg-gray-50 rounded-md p-2 border border-gray-100">
                <Users className="h-6 w-6 text-[#ECC462]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Parent/Guardian Access</h1>
                <p className="text-sm text-gray-600">Manage who can view and manage your account</p>
              </div>
            </div>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-semibold"
                data-testid="button-add-parent"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Add Parent/Guardian
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Invite Parent/Guardian</DialogTitle>
                <DialogDescription>
                  Send an invitation to a parent or guardian to access your account.
                  They will receive an email to set up their password.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddParent}>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={formData.firstName}
                        onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                        required
                        data-testid="input-parent-firstname"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={formData.lastName}
                        onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                        required
                        data-testid="input-parent-lastname"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                      data-testid="input-parent-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone (Optional)</Label>
                    <Input
                      id="phone"
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      data-testid="input-parent-phone"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="relationship">Relationship</Label>
                    <Input
                      id="relationship"
                      placeholder="e.g., Parent, Guardian, etc."
                      value={formData.relationship}
                      onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                      data-testid="input-parent-relationship"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="permissionLevel">Permission Level</Label>
                    <Select
                      value={formData.permissionLevel}
                      onValueChange={(value) => setFormData({ ...formData, permissionLevel: value })}
                    >
                      <SelectTrigger data-testid="select-permission-level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="view_only">View Only</SelectItem>
                        <SelectItem value="view_book">View + Book Classes</SelectItem>
                        <SelectItem value="view_book_pay">View + Book + Payments</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-500">
                      {formData.permissionLevel === "view_only" && "Can view your progress and schedule only"}
                      {formData.permissionLevel === "view_book" && "Can view your information and book classes for you"}
                      {formData.permissionLevel === "view_book_pay" && "Full access including payment management"}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                    disabled={addParentMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111]"
                    disabled={addParentMutation.isPending}
                    data-testid="button-send-invite"
                  >
                    {addParentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Invitation
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-6">
        {/* Linked Parents List */}
        {isLoading ? (
          <div className="flex items-center justify-center p-12">
            <div className="text-center">
              <Loader2 className="h-12 w-12 animate-spin text-[#ECC462] mx-auto mb-4" />
              <p className="text-gray-600 font-medium">Loading linked parents...</p>
            </div>
          </div>
        ) : linkedParents.length === 0 ? (
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardContent className="p-16 text-center">
              <div className="bg-gray-50 rounded-full h-20 w-20 flex items-center justify-center mx-auto mb-6 border border-gray-100">
                <Users className="h-10 w-10 text-gray-300" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No Parents Linked</h3>
              <p className="text-gray-600 max-w-md mx-auto mb-8">
                You haven't added any parents or guardians yet. Link an account to allow someone else to manage your schedule and payments.
              </p>
              <Button
                variant="outline"
                onClick={() => setIsAddDialogOpen(true)}
                className="border-[#ECC462] text-[#111111] hover:bg-[#ECC462]/10"
              >
                <UserPlus className="mr-2 h-4 w-4" />
                Invite Parent Now
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {linkedParents.map((link) => (
              <Card key={link.id} className="bg-white border border-gray-200 rounded-md shadow-sm hover:border-gray-300 transition-colors h-full flex flex-col">
                <CardContent className="p-6 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex gap-4 min-w-0 flex-1">
                      <div className="bg-gray-50 border border-gray-100 p-3 rounded-md shrink-0 h-fit">
                        <User className="h-6 w-6 text-gray-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-lg text-gray-900 truncate" data-testid={`text-parent-name-${link.id}`} title={`${link.parent?.firstName} ${link.parent?.lastName}`}>
                          {link.parent?.firstName} {link.parent?.lastName}
                        </h3>
                        {link.parent?.relationship && (
                          <p className="text-sm font-medium text-[#ECC462] uppercase tracking-wider text-[10px]">{link.parent.relationship}</p>
                        )}
                        <div className="flex flex-col gap-1.5 mt-3">
                          <div className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            <span className="truncate" title={link.parent?.email}>{link.parent?.email}</span>
                          </div>
                          {link.parent?.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Phone className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                              <span className="truncate">{link.parent.phone}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteParent(link)}
                      className="text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0 h-8 w-8"
                      data-testid={`button-remove-parent-${link.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="mt-auto pt-4 border-t border-gray-50">
                    {editingPermission === link.id ? (
                      <div className="flex flex-col gap-2">
                        <Select
                          value={link.permissionLevel}
                          onValueChange={(value) => {
                            updatePermissionMutation.mutate({ id: link.id, permissionLevel: value });
                          }}
                        >
                          <SelectTrigger className="w-full" data-testid={`select-edit-permission-${link.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="view_only">View Only</SelectItem>
                            <SelectItem value="view_book">View + Book Classes</SelectItem>
                            <SelectItem value="view_book_pay">View + Book + Payments</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPermission(null)}
                          disabled={updatePermissionMutation.isPending}
                          className="h-8 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-[#ECC462] shrink-0" />
                          <span className="text-sm font-medium text-gray-700 truncate" data-testid={`text-permission-${link.id}`}>
                            {getPermissionLabel(link.permissionLevel)}
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditingPermission(link.id)}
                          data-testid={`button-edit-permission-${link.id}`}
                          className="h-8 w-8 text-gray-400 hover:text-[#ECC462]"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Parent Access?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {selectedParentLink?.parent?.firstName}'s access to your account?
              They will no longer be able to view your information or manage your bookings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteParentMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedParentLink && deleteParentMutation.mutate(selectedParentLink.id)}
              disabled={deleteParentMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-confirm-remove"
            >
              {deleteParentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
