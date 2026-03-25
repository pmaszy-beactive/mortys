import { useQuery } from "@tanstack/react-query";
import type { Instructor } from "@shared/schema";

export function useInstructorAuth() {
  const { data: instructor, isLoading, error } = useQuery<Instructor>({
    queryKey: ["/api/instructor/me"],
    retry: false,
    refetchOnMount: "always",
    staleTime: 0, // Always refetch
  });

  return {
    instructor,
    isLoading,
    isAuthenticated: !!instructor && !error,
    error,
  };
}