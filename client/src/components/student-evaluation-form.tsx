import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Star, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Student, Class } from "@shared/schema";

interface RatingCategory {
  id: string;
  label: string;
  description: string;
}

const ratingCategories: RatingCategory[] = [
  {
    id: "punctuality",
    label: "Punctuality",
    description: "Arrives on time and ready to learn"
  },
  {
    id: "vehicleControl",
    label: "Vehicle Control",
    description: "Steering, acceleration, braking, and overall vehicle handling"
  },
  {
    id: "roadAwareness",
    label: "Road Awareness",
    description: "Observation skills, checking mirrors, and situational awareness"
  },
  {
    id: "trafficRules",
    label: "Traffic Rules Knowledge",
    description: "Understanding and following traffic laws and regulations"
  }
];

interface StudentEvaluationFormProps {
  student: Student;
  classData: Class;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function StudentEvaluationForm({ student, classData, onSuccess, onCancel }: StudentEvaluationFormProps) {
  const { toast } = useToast();
  const [ratings, setRatings] = useState<Record<string, number>>({
    punctuality: 0,
    vehicleControl: 0,
    roadAwareness: 0,
    trafficRules: 0,
  });
  const [comments, setComments] = useState("");
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [hoveredRating, setHoveredRating] = useState<Record<string, number>>({});

  const submitEvaluationMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/instructor/evaluations", {
        studentId: student.id,
        classId: classData.id,
        ratings,
        comments: comments.trim(),
      });
    },
    onSuccess: () => {
      toast({
        title: "Evaluation Submitted",
        description: `Successfully submitted evaluation for ${student.firstName} ${student.lastName}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/instructor/evaluations"] });
      if (onSuccess) onSuccess();
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit evaluation",
        variant: "destructive",
      });
    },
  });

  const handleRatingClick = (categoryId: string, rating: number) => {
    setRatings(prev => ({
      ...prev,
      [categoryId]: rating
    }));
  };

  const handleSubmit = () => {
    // Check if all categories are rated
    const allRated = Object.values(ratings).every(r => r > 0);
    if (!allRated) {
      toast({
        title: "Incomplete Evaluation",
        description: "Please provide ratings for all categories",
        variant: "destructive",
      });
      return;
    }
    submitEvaluationMutation.mutate();
  };

  const averageRating = Object.values(ratings).reduce((sum, r) => sum + r, 0) / Object.values(ratings).length;

  // Frontend gating: only allow evaluation for completed classes
  if (classData.status !== 'completed') {
    return (
      <Card className="border-0 shadow-xl bg-white">
        <CardHeader className="border-b bg-gradient-to-r from-orange-50 to-yellow-50">
          <CardTitle className="text-orange-900 flex items-center">
            <Star className="mr-2 h-5 w-5 text-orange-500" />
            Evaluation Not Available
          </CardTitle>
          <CardDescription>
            Cannot evaluate {student.firstName} {student.lastName} for Class {classData.classNumber}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-orange-800 font-medium mb-2">
              This class must be completed before you can submit an evaluation.
            </p>
            <p className="text-sm text-orange-700">
              Current class status: <span className="font-semibold">{classData.status}</span>
            </p>
            <p className="text-sm text-orange-700 mt-2">
              Please complete the class first, then return here to submit your evaluation.
            </p>
          </div>
          {onCancel && (
            <div className="mt-4">
              <Button
                onClick={onCancel}
                variant="outline"
                className="w-full border-gray-300"
                data-testid="button-close-evaluation-form"
              >
                Close
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-xl bg-white">
      <CardHeader className="border-b bg-gradient-to-r from-[#ECC462]/10 to-[#ECC462]/5">
        <CardTitle className="text-[#111111] flex items-center">
          <Star className="mr-2 h-5 w-5 text-[#ECC462]" />
          Student Evaluation
        </CardTitle>
        <CardDescription>
          Evaluate {student.firstName} {student.lastName} for Class {classData.classNumber}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        {/* Rating Categories */}
        <div className="space-y-6">
          {ratingCategories.map((category) => (
            <div key={category.id} className="space-y-2">
              <div>
                <Label className="text-sm font-semibold text-[#111111]">
                  {category.label}
                </Label>
                <p className="text-xs text-gray-500 mt-1">{category.description}</p>
              </div>
              <div className="flex items-center space-x-2">
                {[1, 2, 3, 4, 5].map((star) => {
                  const isActive = star <= ratings[category.id];
                  const isHovered = hoveredCategory === category.id && star <= (hoveredRating[category.id] || 0);
                  
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => handleRatingClick(category.id, star)}
                      onMouseEnter={() => {
                        setHoveredCategory(category.id);
                        setHoveredRating(prev => ({ ...prev, [category.id]: star }));
                      }}
                      onMouseLeave={() => {
                        setHoveredCategory(null);
                        setHoveredRating(prev => ({ ...prev, [category.id]: 0 }));
                      }}
                      className="focus:outline-none focus:ring-2 focus:ring-[#ECC462] rounded-full p-1 transition-transform hover:scale-110"
                      data-testid={`rating-${category.id}-${star}`}
                    >
                      <Star
                        className={`h-8 w-8 transition-colors ${
                          isActive || isHovered
                            ? "fill-[#ECC462] text-[#ECC462]"
                            : "text-gray-300"
                        }`}
                      />
                    </button>
                  );
                })}
                {ratings[category.id] > 0 && (
                  <span className="ml-2 text-sm font-medium text-[#111111]">
                    {ratings[category.id]}/5
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Overall Rating Display */}
        {averageRating > 0 && (
          <div className="p-4 bg-[#ECC462]/10 rounded-lg border border-[#ECC462]/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#111111]">Overall Rating</span>
              <span className="text-2xl font-bold text-[#111111]">
                {averageRating.toFixed(1)}/5
              </span>
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="space-y-2">
          <Label htmlFor="comments" className="text-sm font-semibold text-[#111111]">
            Additional Comments (Optional)
          </Label>
          <Textarea
            id="comments"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="Share any additional observations, strengths, or areas for improvement..."
            className="min-h-[120px] border-gray-300 focus:border-[#ECC462] focus:ring-[#ECC462]"
            data-testid="input-evaluation-comments"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={submitEvaluationMutation.isPending}
            className="flex-1 bg-[#ECC462] text-[#111111] hover:bg-[#ECC462]/90 hover:text-[#111111] font-semibold shadow-md"
            data-testid="button-submit-evaluation"
          >
            {submitEvaluationMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              "Submit Evaluation"
            )}
          </Button>
          {onCancel && (
            <Button
              onClick={onCancel}
              variant="outline"
              disabled={submitEvaluationMutation.isPending}
              className="flex-1 border-gray-300"
              data-testid="button-cancel-evaluation"
            >
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
