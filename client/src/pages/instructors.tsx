import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, User, Award, UserCheck } from "lucide-react";
import InstructorForm from "@/components/instructor-form";
import type { Instructor } from "@shared/schema";

export default function Instructors() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const { data: instructors = [], isLoading } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

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
                  Instructors
                </h1>
                <UserCheck className="h-6 w-6 text-[#ECC462]" />
              </div>
              <p className="text-sm text-gray-600">
                Manage instructor profiles, specializations, and assignments.
              </p>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button className="bg-[#ECC462] hover:bg-[#ECC462]/90 text-[#111111] font-semibold">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Instructor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Instructor</DialogTitle>
                  <DialogDescription>
                    Create a new instructor profile with their credentials and specializations.
                  </DialogDescription>
                </DialogHeader>
                <InstructorForm onSuccess={() => setIsCreateDialogOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <User className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal">
                Total
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Total Instructors</p>
              <p className="text-3xl font-bold text-gray-900">{instructors.length}</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-start justify-between mb-4">
              <div className="text-gray-500">
                <Award className="h-5 w-5" />
              </div>
              <Badge variant="outline" className="text-xs font-normal text-green-600 border-green-200 bg-green-50">
                Active
              </Badge>
            </div>
            <div>
              <p className="text-gray-600 text-xs font-medium uppercase tracking-wider mb-1">Active</p>
              <p className="text-3xl font-bold text-gray-900">
                {instructors.filter(i => i.status === 'active').length}
              </p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
