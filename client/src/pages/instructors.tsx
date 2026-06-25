import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, User, Award, UserCheck, ChevronRight, Mail } from "lucide-react";
import InstructorForm from "@/components/instructor-form";
import type { Instructor } from "@shared/schema";

function getSpecializationLabels(specializations: unknown): string[] {
  if (!specializations) return [];
  let value = specializations;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter(Boolean);
  }
  if (typeof value === "object" && value !== null) {
    return Object.keys(value as Record<string, unknown>);
  }
  return [];
}

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

        {/* Instructor List */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">All Instructors</h2>
          {instructors.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-md p-10 text-center" data-testid="empty-instructors">
              <UserCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-900">No instructors yet</p>
              <p className="text-sm text-gray-500 mt-1">
                Add your first instructor to get started.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {instructors.map((instructor) => {
                const specializations = getSpecializationLabels(instructor.specializations);
                return (
                  <Link
                    key={instructor.id}
                    href={`/instructors/${instructor.id}`}
                    data-testid={`link-instructor-${instructor.id}`}
                  >
                    <div className="group bg-white border border-gray-200 rounded-md p-5 cursor-pointer hover-elevate transition-colors h-full">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-[#ECC462]/20 flex items-center justify-center shrink-0">
                            <User className="h-5 w-5 text-[#111111]" />
                          </div>
                          <div className="min-w-0">
                            <p
                              className="text-sm font-semibold text-gray-900 truncate"
                              data-testid={`text-instructor-name-${instructor.id}`}
                            >
                              {instructor.firstName} {instructor.lastName}
                            </p>
                            <div className="flex items-center gap-1 text-xs text-gray-500 truncate">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{instructor.email}</span>
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-gray-400 shrink-0 group-hover:text-gray-600" />
                      </div>

                      <div className="mt-4 flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={
                            instructor.status === "active"
                              ? "text-xs font-normal text-green-600 border-green-200 bg-green-50"
                              : "text-xs font-normal text-gray-500"
                          }
                          data-testid={`status-instructor-${instructor.id}`}
                        >
                          {instructor.status}
                        </Badge>
                        {specializations.slice(0, 3).map((label) => (
                          <Badge key={label} variant="outline" className="text-xs font-normal">
                            {label}
                          </Badge>
                        ))}
                        {specializations.length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{specializations.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
