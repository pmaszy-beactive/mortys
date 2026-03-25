import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heart, Save, User } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Student, Instructor } from "@shared/schema";

interface FavoriteInstructorSectionProps {
  student: Student;
  onUpdate: () => void;
}

export default function FavoriteInstructorSection({ student, onUpdate }: FavoriteInstructorSectionProps) {
  const [selectedInstructorId, setSelectedInstructorId] = useState<string>(
    student.favoriteInstructorId?.toString() || "none"
  );
  const { toast } = useToast();

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const updateMutation = useMutation({
    mutationFn: (data: { favoriteInstructorId: number | null }) => 
      apiRequest("PUT", `/api/students/${student.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students", student.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      toast({
        title: "Success",
        description: "Favorite instructor updated successfully",
      });
      onUpdate();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update favorite instructor",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const instructorId = selectedInstructorId === "none" ? null : parseInt(selectedInstructorId);
    updateMutation.mutate({ favoriteInstructorId: instructorId });
  };

  const currentFavoriteInstructor = instructors.find(
    (instructor) => instructor.id === student.favoriteInstructorId
  );

  const hasChanged = selectedInstructorId !== (student.favoriteInstructorId?.toString() || "none");

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2">
        <Heart className="h-4 w-4 text-red-500" />
        <h4 className="font-medium text-sm">Favorite Instructor</h4>
      </div>
      
      {currentFavoriteInstructor && !hasChanged && (
        <Card className="p-3 bg-red-50 border-red-200">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
              <User className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="font-medium text-sm text-red-800">
                {currentFavoriteInstructor.firstName} {currentFavoriteInstructor.lastName}
              </p>
              <p className="text-xs text-red-600">
                {(() => {
                  try {
                    if (typeof currentFavoriteInstructor.specializations === 'string') {
                      const parsed = JSON.parse(currentFavoriteInstructor.specializations);
                      return Array.isArray(parsed) ? parsed.join(", ") : "General instruction";
                    }
                    return Array.isArray(currentFavoriteInstructor.specializations) 
                      ? currentFavoriteInstructor.specializations.join(", ") 
                      : "General instruction";
                  } catch {
                    return "General instruction";
                  }
                })()}
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <Select value={selectedInstructorId} onValueChange={setSelectedInstructorId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select favorite instructor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No preference</SelectItem>
            {instructors.map((instructor) => (
              <SelectItem key={instructor.id} value={instructor.id.toString()}>
                <div className="flex items-center space-x-2">
                  <span>{instructor.firstName} {instructor.lastName}</span>
                  {instructor.specializations && (
                    <span className="text-xs text-gray-500">
                      ({(() => {
                        try {
                          if (typeof instructor.specializations === 'string') {
                            const parsed = JSON.parse(instructor.specializations);
                            return Array.isArray(parsed) ? parsed.join(", ") : "General";
                          }
                          return Array.isArray(instructor.specializations) 
                            ? instructor.specializations.join(", ") 
                            : "General";
                        } catch {
                          return "General";
                        }
                      })()})
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasChanged && (
          <Button 
            onClick={handleSave} 
            disabled={updateMutation.isPending}
            size="sm" 
            className="w-full touch-target"
          >
            <Save className="h-4 w-4 mr-2" />
            {updateMutation.isPending ? "Saving..." : "Save Preference"}
          </Button>
        )}
      </div>

      <p className="text-xs text-gray-500">
        This preference will be used for scheduling to prioritize classes with this instructor when possible.
      </p>
    </div>
  );
}