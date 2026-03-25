import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudentCourse } from "@shared/schema";

const SELECTED_COURSE_KEY = "morty_selected_course_id";

export function useSelectedCourse() {
  const [selectedCourseId, setSelectedCourseId] = useState<number | null>(() => {
    const stored = localStorage.getItem(SELECTED_COURSE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: courses = [], isLoading } = useQuery<StudentCourse[]>({
    queryKey: ["/api/student/courses"],
  });

  useEffect(() => {
    if (courses.length === 0) return;
    
    const storedIdExists = selectedCourseId !== null && courses.some(c => c.id === selectedCourseId);
    
    if (!storedIdExists) {
      const activeCourse = courses.find(c => c.status === "active") || courses[0];
      setSelectedCourseId(activeCourse.id);
      localStorage.setItem(SELECTED_COURSE_KEY, String(activeCourse.id));
    }
  }, [courses, selectedCourseId]);

  useEffect(() => {
    if (selectedCourseId !== null) {
      localStorage.setItem(SELECTED_COURSE_KEY, String(selectedCourseId));
    }
  }, [selectedCourseId]);

  const selectedCourse = useMemo(() => {
    if (courses.length === 0) return null;
    return courses.find(c => c.id === selectedCourseId) || courses.find(c => c.status === "active") || courses[0];
  }, [courses, selectedCourseId]);

  const selectCourse = (courseId: number) => {
    setSelectedCourseId(courseId);
    localStorage.setItem(SELECTED_COURSE_KEY, String(courseId));
  };

  return {
    courses,
    selectedCourse,
    selectedCourseId: selectedCourse?.id || null,
    selectCourse,
    isLoading,
    hasCourses: courses.length > 0,
    hasMultipleCourses: courses.length > 1,
  };
}
