import { useQuery } from "@tanstack/react-query";
import type { Student } from "@shared/schema";

export function useStudentAuth() {
  const { data: student, isLoading, error } = useQuery<Student>({
    queryKey: ["/api/student/me"],
    retry: false,
    refetchOnMount: "always",
    staleTime: 0, // Always refetch
  });

  return {
    student,
    isLoading,
    isAuthenticated: !!student && !error,
    error,
  };
}
