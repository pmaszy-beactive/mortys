import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Star,
  TrendingUp,
  ArrowLeft,
  Award,
  Target,
  CheckCircle2,
  AlertCircle,
  Calendar,
  User,
  BookOpen,
  Car,
  Loader2,
  Eye,
  Clock,
  MapPin,
  Cloud,
  FileText,
  ThumbsUp,
  MessageSquare,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Link } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import type { Evaluation, Instructor } from "@shared/schema";

interface EvaluationWithInstructor extends Evaluation {
  instructor: Instructor | null;
}

export default function StudentEvaluations() {
  const { student } = useStudentAuth();
  const [selectedEvaluation, setSelectedEvaluation] = useState<EvaluationWithInstructor | null>(null);
  const [showAllEvaluations, setShowAllEvaluations] = useState(false);

  const { data: evaluations = [], isLoading } = useQuery<EvaluationWithInstructor[]>({
    queryKey: ["/api/student/evaluations"],
  });

  // Calculate progress metrics
  const totalEvaluations = evaluations.length;
  const averageRating = totalEvaluations > 0
    ? evaluations.reduce((sum, e) => sum + (e.overallRating || 0), 0) / totalEvaluations
    : 0;
  const signedOffCount = evaluations.filter(e => e.signedOff).length;
  const sortedEvaluations = [...evaluations].sort((a, b) => 
    new Date(b.evaluationDate).getTime() - new Date(a.evaluationDate).getTime()
  );
  const displayedEvaluations = showAllEvaluations ? sortedEvaluations : sortedEvaluations.slice(0, 5);

  // Get all strengths and weaknesses mentioned (handle both comma and newline delimited)
  const allStrengths = evaluations
    .filter(e => e.strengths)
    .flatMap(e => e.strengths?.split(/[,\n]+/).map(s => s.trim().replace(/^[•\-\*]\s*/, '')) || [])
    .filter(Boolean);
  const allWeaknesses = evaluations
    .filter(e => e.weaknesses)
    .flatMap(e => e.weaknesses?.split(/[,\n]+/).map(s => s.trim().replace(/^[•\-\*]\s*/, '')) || [])
    .filter(Boolean);

  // Count frequency of strengths and weaknesses
  const strengthCounts = allStrengths.reduce((acc, s) => {
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const weaknessCounts = allWeaknesses.reduce((acc, w) => {
    acc[w] = (acc[w] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topStrengths = Object.entries(strengthCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const topWeaknesses = Object.entries(weaknessCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const getSessionTypeLabel = (type: string) => {
    if (type === 'in-car') return 'In-Car Practice';
    if (type === 'theory') return 'Theory Class';
    return type;
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4) return 'text-green-600';
    if (rating >= 3) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const getRatingBadge = (rating: number) => {
    if (rating >= 4) return 'bg-green-100 text-green-700';
    if (rating >= 3) return 'bg-yellow-100 text-yellow-700';
    return 'bg-orange-100 text-orange-700';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-[#ECC462] mx-auto mb-4" />
          <p className="text-gray-600 font-medium">Loading your evaluations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex items-center justify-between">
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
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                My Evaluations & Progress
              </h1>
              <p className="text-sm text-gray-600">
                Track your improvement and instructor feedback
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="space-y-8">
        {totalEvaluations === 0 ? (
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardContent className="p-12 text-center">
              <Award className="h-16 w-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No Evaluations Yet</h3>
              <p className="text-gray-500">
                Your instructor evaluations will appear here after your lessons.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Progress Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="stat-card">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Total Evaluations</p>
                      <p className="text-3xl font-bold text-gray-900 mt-1" data-testid="text-total-evaluations">
                        {totalEvaluations}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                      <BookOpen className="h-8 w-8 text-gray-400" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="stat-card">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Average Rating</p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className={`text-3xl font-bold ${getRatingColor(averageRating)}`} data-testid="text-avg-rating">
                          {averageRating.toFixed(1)}
                        </p>
                        <div className="flex">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-5 w-5 ${
                                star <= averageRating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                      <Star className="h-8 w-8 text-yellow-500/50" />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="stat-card">
                <CardContent className="p-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-600">Signed Off</p>
                      <p className="text-3xl font-bold text-green-600 mt-1" data-testid="text-signed-off">
                        {signedOffCount}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        of {totalEvaluations} evaluations
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-3 border border-gray-100">
                      <CheckCircle2 className="h-8 w-8 text-green-500/50" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Strengths and Areas for Improvement */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-white border border-gray-200 rounded-md shadow-sm border-l-4 border-l-green-500">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center text-lg font-semibold text-gray-900">
                    <CheckCircle2 className="mr-2 h-5 w-5 text-green-500" />
                    Your Strengths
                  </CardTitle>
                  <CardDescription>Most frequently mentioned by instructors</CardDescription>
                </CardHeader>
                <CardContent>
                  {topStrengths.length > 0 ? (
                    <div className="space-y-3">
                      {topStrengths.map(([strength, count], index) => (
                        <div key={index} className="flex items-center justify-between gap-2 min-w-0 bg-gray-50/50 p-2 rounded-md">
                          <span className="text-sm text-gray-700 break-words min-w-0 flex-1">{strength}</span>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 rounded-sm">
                            {count}x
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No strengths recorded yet</p>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-white border border-gray-200 rounded-md shadow-sm border-l-4 border-l-amber-500">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center text-lg font-semibold text-gray-900">
                    <Target className="mr-2 h-5 w-5 text-amber-500" />
                    Areas for Improvement
                  </CardTitle>
                  <CardDescription>Focus areas identified by instructors</CardDescription>
                </CardHeader>
                <CardContent>
                  {topWeaknesses.length > 0 ? (
                    <div className="space-y-3">
                      {topWeaknesses.map(([weakness, count], index) => (
                        <div key={index} className="flex items-center justify-between gap-2 min-w-0 bg-gray-50/50 p-2 rounded-md">
                          <span className="text-sm text-gray-700 break-words min-w-0 flex-1">{weakness}</span>
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 rounded-sm">
                            {count}x
                          </Badge>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No areas for improvement recorded</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Evaluation History */}
            <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-gray-900">
                  Evaluation History
                </CardTitle>
                <CardDescription>
                  All instructor feedback and assessments ({totalEvaluations} total)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6" data-testid="evaluations-list">
                  {displayedEvaluations.map((evaluation, index) => (
                    <div key={evaluation.id} data-testid={`evaluation-card-${evaluation.id}`} className="p-4 rounded-md border border-gray-100 hover:border-gray-200 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 min-w-0">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-4 min-w-0">
                            <div className={`p-2.5 rounded-md border shrink-0 ${
                              evaluation.sessionType === 'in-car' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-purple-50 text-purple-700 border-purple-100'
                            }`}>
                              {evaluation.sessionType === 'in-car' ? (
                                <Car className="h-5 w-5" />
                              ) : (
                                <BookOpen className="h-5 w-5" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="font-semibold text-gray-900" data-testid={`eval-type-${evaluation.id}`}>
                                  {getSessionTypeLabel(evaluation.sessionType)}
                                </h3>
                                {evaluation.signedOff && (
                                  <Badge className="bg-green-50 text-green-700 border-green-200 rounded-sm" data-testid={`eval-signed-${evaluation.id}`}>
                                    Signed Off
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-gray-500">
                                <div className="flex items-center gap-1.5" data-testid={`eval-date-${evaluation.id}`}>
                                  <Calendar className="h-4 w-4" />
                                  {new Date(evaluation.evaluationDate).toLocaleDateString()}
                                </div>
                                {evaluation.instructor && (
                                  <div className="flex items-center gap-1.5" data-testid={`eval-instructor-${evaluation.id}`}>
                                    <User className="h-4 w-4" />
                                    {evaluation.instructor.firstName} {evaluation.instructor.lastName}
                                  </div>
                                )}
                              </div>
                              
                              {/* Rating */}
                              {evaluation.overallRating && (
                                <div className="mt-3 flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">Rating:</span>
                                  <div className="flex">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <Star
                                        key={star}
                                        className={`h-4 w-4 ${
                                          star <= evaluation.overallRating! ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                                        }`}
                                      />
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Strengths & Weaknesses (Compact) */}
                              {(evaluation.strengths || evaluation.weaknesses) && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                  {evaluation.strengths && (
                                    <div className="bg-green-50/50 p-2.5 rounded-md border border-green-100/50">
                                      <p className="text-xs font-semibold text-green-800 uppercase tracking-wider mb-1">Strengths</p>
                                      <p className="text-sm text-gray-700 line-clamp-2">{evaluation.strengths}</p>
                                    </div>
                                  )}
                                  {evaluation.weaknesses && (
                                    <div className="bg-amber-50/50 p-2.5 rounded-md border border-amber-100/50">
                                      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider mb-1">To Improve</p>
                                      <p className="text-sm text-gray-700 line-clamp-2">{evaluation.weaknesses}</p>
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="mt-4">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setSelectedEvaluation(evaluation)}
                                  className="border-gray-200 hover:bg-gray-50 text-gray-700 rounded-md"
                                  data-testid={`button-view-eval-${evaluation.id}`}
                                >
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Full Details
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Show More / Show Less Button */}
                {totalEvaluations > 5 && (
                  <div className="mt-8 text-center">
                    <Button
                      variant="outline"
                      onClick={() => setShowAllEvaluations(!showAllEvaluations)}
                      className="border-gray-200 hover:bg-gray-50 text-gray-700 rounded-md"
                      data-testid="button-toggle-evaluations"
                    >
                      {showAllEvaluations ? (
                        <>
                          <ChevronUp className="h-4 w-4 mr-2" />
                          Show Less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4 mr-2" />
                          Show All {totalEvaluations} Evaluations
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Evaluation Detail Dialog */}
      <Dialog open={!!selectedEvaluation} onOpenChange={(open) => !open && setSelectedEvaluation(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className={`p-2 rounded-lg ${
                selectedEvaluation?.sessionType === 'in-car' ? 'bg-blue-100' : 'bg-purple-100'
              }`}>
                {selectedEvaluation?.sessionType === 'in-car' ? (
                  <Car className="h-5 w-5 text-blue-600" />
                ) : (
                  <BookOpen className="h-5 w-5 text-purple-600" />
                )}
              </div>
              <span>Evaluation Details</span>
              {selectedEvaluation?.signedOff ? (
                <Badge className="bg-green-100 text-green-700 ml-2">Signed Off</Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-700 ml-2">Awaiting Signature</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedEvaluation && (
                <span className="flex items-center gap-4 mt-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {new Date(selectedEvaluation.evaluationDate).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </span>
                  {selectedEvaluation.instructor && (
                    <span className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {selectedEvaluation.instructor.firstName} {selectedEvaluation.instructor.lastName}
                    </span>
                  )}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedEvaluation && (
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-6">
                {/* Session Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Session Type</p>
                    <p className="font-semibold text-gray-900 mt-1">
                      {selectedEvaluation.sessionType === 'in-car' ? 'In-Car Practice' : 
                       selectedEvaluation.sessionType === 'theory' ? 'Theory Class' : 
                       selectedEvaluation.sessionType}
                    </p>
                  </div>
                  {selectedEvaluation.duration && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Duration
                      </p>
                      <p className="font-semibold text-gray-900 mt-1">{selectedEvaluation.duration} minutes</p>
                    </div>
                  )}
                  {selectedEvaluation.vehicleType && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Vehicle Type</p>
                      <p className="font-semibold text-gray-900 mt-1 capitalize">{selectedEvaluation.vehicleType}</p>
                    </div>
                  )}
                  {selectedEvaluation.sessionNumber && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide">Session #</p>
                      <p className="font-semibold text-gray-900 mt-1">{selectedEvaluation.sessionNumber}</p>
                    </div>
                  )}
                </div>

                {/* Overall Rating */}
                {selectedEvaluation.overallRating && (
                  <div className="bg-gradient-to-r from-[#ECC462]/10 to-amber-100/50 rounded-lg p-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Overall Rating</p>
                    <div className="flex items-center gap-3">
                      <span className={`text-4xl font-bold ${getRatingColor(selectedEvaluation.overallRating)}`}>
                        {selectedEvaluation.overallRating}
                      </span>
                      <span className="text-xl text-gray-400">/5</span>
                      <div className="flex ml-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`h-6 w-6 ${
                              star <= selectedEvaluation.overallRating! ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Detailed Ratings */}
                {selectedEvaluation.ratings && typeof selectedEvaluation.ratings === 'object' && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Skill Ratings
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Object.entries(selectedEvaluation.ratings as Record<string, number>).map(([skill, ratingValue]) => {
                        const rating = Number(ratingValue);
                        return (
                          <div key={skill} className="bg-gray-50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm text-gray-600 capitalize">
                                {skill.replace(/([A-Z])/g, ' $1').trim()}
                              </span>
                              <Badge className={getRatingBadge(rating)}>{rating}/5</Badge>
                            </div>
                            <Progress value={(rating / 5) * 100} className="h-2" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Conditions (weather, traffic, route) */}
                {(selectedEvaluation.weatherConditions || selectedEvaluation.trafficConditions || selectedEvaluation.routeDescription) && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Lesson Conditions
                    </h4>
                    <div className="grid gap-2">
                      {selectedEvaluation.weatherConditions && (
                        <div className="flex items-center gap-2 text-sm">
                          <Cloud className="h-4 w-4 text-blue-500" />
                          <span className="text-gray-600">Weather:</span>
                          <span className="text-gray-900">{selectedEvaluation.weatherConditions}</span>
                        </div>
                      )}
                      {selectedEvaluation.trafficConditions && (
                        <div className="flex items-center gap-2 text-sm">
                          <Car className="h-4 w-4 text-orange-500" />
                          <span className="text-gray-600">Traffic:</span>
                          <span className="text-gray-900">{selectedEvaluation.trafficConditions}</span>
                        </div>
                      )}
                      {selectedEvaluation.routeDescription && (
                        <div className="flex items-start gap-2 text-sm">
                          <MapPin className="h-4 w-4 text-green-500 mt-0.5" />
                          <span className="text-gray-600">Route:</span>
                          <span className="text-gray-900 break-words [overflow-wrap:anywhere]">{selectedEvaluation.routeDescription}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Strengths */}
                {selectedEvaluation.strengths && (
                  <div className="bg-green-50 rounded-lg p-4 border border-green-100">
                    <h4 className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-2">
                      <ThumbsUp className="h-4 w-4" />
                      Strengths
                    </h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-hidden">{selectedEvaluation.strengths}</p>
                  </div>
                )}

                {/* Areas for Improvement */}
                {selectedEvaluation.weaknesses && (
                  <div className="bg-orange-50 rounded-lg p-4 border border-orange-100">
                    <h4 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Areas for Improvement
                    </h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-hidden">{selectedEvaluation.weaknesses}</p>
                  </div>
                )}

                {/* Recommendations */}
                {selectedEvaluation.recommendationsForNext && (
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
                    <h4 className="text-sm font-semibold text-blue-700 mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Recommendations for Next Session
                    </h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-hidden">{selectedEvaluation.recommendationsForNext}</p>
                  </div>
                )}

                {/* Instructor Comments/Notes */}
                {(selectedEvaluation.comments || selectedEvaluation.notes) && (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Instructor Comments
                    </h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-hidden">
                      {selectedEvaluation.comments || selectedEvaluation.notes}
                    </p>
                  </div>
                )}

                {/* Skills Assessed */}
                {selectedEvaluation.skillsAssessed && Array.isArray(selectedEvaluation.skillsAssessed) && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-2">Skills Assessed</h4>
                    <div className="flex flex-wrap gap-2">
                      {(selectedEvaluation.skillsAssessed as string[]).map((skill: string, idx: number) => (
                        <Badge key={idx} variant="outline" className="bg-white">
                          {String(skill)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Signature Info */}
                <div className="border-t pt-4 mt-4">
                  {selectedEvaluation.signedOff && selectedEvaluation.signatureDate ? (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>
                        Signed off on {new Date(selectedEvaluation.signatureDate).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric'
                        })}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <AlertCircle className="h-4 w-4" />
                      <span>This evaluation is awaiting instructor sign-off</span>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
