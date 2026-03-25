import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users, GraduationCap, Car, Bike, ChevronRight, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery } from "@tanstack/react-query";

interface LinkedStudent {
  id: number;
  studentId: number;
  permissionLevel: string;
  student: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    courseType: string;
    status: string;
    progress: number;
  } | null;
}

export default function SelectStudent() {
  const [isSelecting, setIsSelecting] = useState<number | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: parentData, isLoading } = useQuery({
    queryKey: ["/api/parent/linked-students"],
    queryFn: async () => {
      const response = await fetch("/api/parent/linked-students", {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401) {
          setLocation("/parent/login");
          return [];
        }
        throw new Error("Failed to fetch students");
      }
      return response.json();
    },
  });

  const linkedStudents: LinkedStudent[] = parentData || [];

  const handleSelectStudent = async (studentId: number) => {
    setIsSelecting(studentId);
    
    try {
      const response = await apiRequest("POST", "/api/parent/select-student", { studentId });
      
      if (response.success) {
        await queryClient.invalidateQueries({ queryKey: ["/api/parent/me"] });
        
        toast({
          title: "Student selected",
          description: `Now viewing ${response.student.firstName}'s information.`,
        });
        
        setLocation("/parent/dashboard");
      }
    } catch (err: any) {
      toast({
        title: "Selection failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSelecting(null);
    }
  };

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/parent/logout", {});
      await queryClient.invalidateQueries({ queryKey: ["/api/parent/me"] });
      setLocation("/parent/login");
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const getCourseIcon = (courseType: string) => {
    switch (courseType) {
      case "moto":
        return <Bike className="h-6 w-6" />;
      case "scooter":
        return <Bike className="h-5 w-5" />;
      default:
        return <Car className="h-6 w-6" />;
    }
  };

  const getCourseLabel = (courseType: string) => {
    switch (courseType) {
      case "moto":
        return "Motorcycle";
      case "scooter":
        return "Scooter";
      default:
        return "Automobile";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "completed":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "on-hold":
        return "bg-orange-100 text-orange-800 border-orange-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#ECC462]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 bg-[#ECC462] rounded-md shadow-sm flex items-center justify-center mb-6">
            <Users className="h-10 w-10 text-[#111111]" />
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-2">
            Select Student
          </h2>
          <p className="text-gray-600 text-lg">
            Choose which student's information you'd like to view
          </p>
        </div>

        <div className="grid gap-4">
          {linkedStudents.map((link) => {
            const student = link.student;
            if (!student) return null;
            
            return (
              <Card 
                key={link.id}
                className="bg-white shadow-sm border border-gray-200 rounded-md overflow-hidden hover:bg-gray-50 transition-colors cursor-pointer group"
                onClick={() => handleSelectStudent(student.id)}
                data-testid={`card-student-${student.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 bg-gray-100 rounded-md flex items-center justify-center">
                        <GraduationCap className="h-7 w-7 text-[#111111]" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {student.firstName} {student.lastName}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex items-center gap-1 text-gray-500">
                            {getCourseIcon(student.courseType)}
                            <span className="text-sm">{getCourseLabel(student.courseType)}</span>
                          </div>
                          <Badge variant="outline" className={`${getStatusColor(student.status)} text-xs border-0`}>
                            {student.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-sm text-gray-500 uppercase tracking-wider font-semibold">Progress</div>
                        <div className="text-2xl font-bold text-gray-900">{student.progress}%</div>
                      </div>
                      <div className="h-10 w-10 rounded-md bg-gray-100 flex items-center justify-center group-hover:bg-[#ECC462] transition-colors">
                        {isSelecting === student.id ? (
                          <Loader2 className="h-5 w-5 animate-spin text-[#111111]" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-[#111111]" />
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Your Permission Level</span>
                      <Badge variant="outline" className="font-medium text-gray-600 border-gray-200">
                        {link.permissionLevel === "view_only" && "View Only"}
                        {link.permissionLevel === "view_book" && "View + Book Classes"}
                        {link.permissionLevel === "view_book_pay" && "Full Access"}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center">
          <Button
            variant="ghost"
            className="text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
