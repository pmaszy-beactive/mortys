import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Search, X, User, GraduationCap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface Instructor {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
}

interface GlobalSearchBarProps {
  userType: "admin" | "instructor";
}

export function GlobalSearchBar({ userType }: GlobalSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Student search — admin fetches by term, instructor fetches all and filters client-side
  const { data: adminData, isLoading: adminLoading } = useQuery<{ students: Student[]; total: number }>({
    queryKey: ["/api/students", searchTerm],
    queryFn: async () => {
      if (searchTerm.length < 2) return { students: [], total: 0 };
      const response = await fetch(`/api/students?searchTerm=${encodeURIComponent(searchTerm)}&limit=10`, { credentials: "include" });
      if (!response.ok) return { students: [], total: 0 };
      return response.json();
    },
    enabled: searchTerm.length >= 2 && userType === "admin",
  });

  const { data: instructorData, isLoading: instructorLoading } = useQuery<Student[]>({
    queryKey: ["/api/instructor/students"],
    enabled: userType === "instructor",
  });

  // Instructor search (admin only) — fetch all and filter client-side
  const { data: allInstructors = [], isLoading: instructorsLoading } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
    enabled: userType === "admin",
    staleTime: 30000,
  });

  const isLoading = userType === "admin" ? (adminLoading || instructorsLoading) : instructorLoading;

  const students: Student[] = userType === "admin"
    ? (adminData?.students || [])
    : (instructorData || []).filter((s) => {
        if (searchTerm.length < 2) return false;
        const term = searchTerm.toLowerCase();
        return (
          s.firstName.toLowerCase().includes(term) ||
          s.lastName.toLowerCase().includes(term) ||
          `${s.firstName} ${s.lastName}`.toLowerCase().includes(term) ||
          (s.email && s.email.toLowerCase().includes(term)) ||
          (s.phone && s.phone.includes(term))
        );
      });

  const matchedInstructors: Instructor[] = userType === "admin" && searchTerm.length >= 2
    ? allInstructors.filter((i) => {
        const term = searchTerm.toLowerCase();
        return (
          i.firstName.toLowerCase().includes(term) ||
          i.lastName.toLowerCase().includes(term) ||
          `${i.firstName} ${i.lastName}`.toLowerCase().includes(term) ||
          (i.email && i.email.toLowerCase().includes(term)) ||
          (i.phone && i.phone.includes(term))
        );
      }).slice(0, 5)
    : [];

  const hasResults = students.length > 0 || matchedInstructors.length > 0;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setIsOpen(true);
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleStudentClick = (student: Student) => {
    setIsOpen(false);
    setSearchTerm("");
    if (userType === "admin") {
      setLocation(`/students/${student.id}`);
    } else {
      setLocation(`/instructor/students/${student.id}`);
    }
  };

  const handleInstructorClick = (instructor: Instructor) => {
    setIsOpen(false);
    setSearchTerm("");
    setLocation(`/instructors/${instructor.id}`);
  };

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-700 bg-white border-gray-200"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">
          {userType === "admin" ? "Search students & instructors..." : "Search students..."}
        </span>
      </Button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            ref={inputRef}
            type="text"
            placeholder={userType === "admin" ? "Search students & instructors..." : "Search students by name, email, or phone..."}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-10 w-72 sm:w-96"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsOpen(false)}
          className="text-gray-500"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {searchTerm.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50 min-w-[380px]">
          {isLoading ? (
            <div className="p-4 text-center text-gray-500">Searching...</div>
          ) : !hasResults ? (
            <div className="p-4 text-center text-gray-500">No results found</div>
          ) : (
            <ul className="py-2">
              {matchedInstructors.length > 0 && (
                <>
                  <li className="px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border-b">
                    Instructors
                  </li>
                  {matchedInstructors.map((instructor) => (
                    <li key={`instructor-${instructor.id}`}>
                      <button
                        onClick={() => handleInstructorClick(instructor)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#ECC462]/10 text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#ECC462]/20 flex items-center justify-center shrink-0">
                          <GraduationCap className="h-4 w-4 text-[#111111]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {instructor.firstName} {instructor.lastName}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {instructor.email}{instructor.phone && ` • ${instructor.phone}`}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${instructor.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {instructor.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </>
              )}

              {students.length > 0 && (
                <>
                  <li className={`px-4 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50 border-b ${matchedInstructors.length > 0 ? 'border-t mt-1' : ''}`}>
                    Students
                  </li>
                  {students.slice(0, 8).map((student) => (
                    <li key={`student-${student.id}`}>
                      <button
                        onClick={() => handleStudentClick(student)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 text-left"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {student.firstName} {student.lastName}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {student.email}{student.phone && ` • ${student.phone}`}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
