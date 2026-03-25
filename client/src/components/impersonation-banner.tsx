import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Eye, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient, getQueryFn } from "@/lib/queryClient";

interface ImpersonationStatus {
  impersonatingStudentId: number | null;
  impersonatingInstructorId: number | null;
  studentName: string | null;
  instructorName: string | null;
}

export default function ImpersonationBanner() {
  const [, setLocation] = useLocation();

  const { data: status } = useQuery<ImpersonationStatus>({
    queryKey: ["/api/admin/impersonation-status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    refetchInterval: 30000,
    staleTime: 0,
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/impersonate/stop"),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/impersonation-status"] });
      if (data?.returnToStudentId) {
        setLocation(`/students/${data.returnToStudentId}`);
      } else if (data?.returnToInstructorId) {
        setLocation(`/instructors/${data.returnToInstructorId}`);
      } else {
        setLocation("/");
      }
    },
  });

  const isActive = !!(status?.impersonatingStudentId || status?.impersonatingInstructorId);
  if (!isActive) return null;

  const name = status?.studentName || status?.instructorName;
  const role = status?.impersonatingStudentId ? "Student" : "Instructor";

  return (
    <div className="w-full bg-[#ECC462] text-black flex items-center justify-between px-4 py-2 text-sm font-medium z-50 shadow-md">
      <div className="flex items-center gap-2">
        <Eye className="h-4 w-4 shrink-0" />
        <span>
          Office Manager View — viewing as <strong>{name}</strong> ({role} Portal)
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="bg-black text-white border-black hover:bg-gray-800 hover:text-white h-7 px-3 text-xs"
        onClick={() => stopMutation.mutate()}
        disabled={stopMutation.isPending}
      >
        <LogOut className="h-3 w-3 mr-1" />
        {stopMutation.isPending ? "Exiting..." : "Exit View"}
      </Button>
    </div>
  );
}
