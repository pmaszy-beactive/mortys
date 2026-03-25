import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Users, Calendar, BookOpen, Car, Search, AlertTriangle, TrendingUp, ChevronDown, ChevronUp, CheckCircle2, Clock, X, CalendarPlus, FilePlus, Send, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MissingAvailability {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface RegistrationSummary {
  total: number;
  thisWeek: { count: number; auto: number; moto: number; scooter: number };
  thisMonth: { count: number; auto: number; moto: number; scooter: number };
}

interface AttendanceStudent {
  enrollmentId: number;
  studentId: number;
  studentName: string;
  attendanceStatus: string;
}

interface TheoryClass {
  classId: number;
  classNumber: number;
  courseType: string;
  time: string;
  room: string | null;
  instructorName: string;
  status: string;
  enrolledCount: number;
  students: AttendanceStudent[];
}

interface TheoryAttendance {
  date: string;
  classes: TheoryClass[];
}

interface ClassOverview {
  total: number;
  theory: number;
  driving: number;
  view: string;
}

// ─── Student Quick Search ─────────────────────────────────────────────────────

function StudentSearchWidget() {
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ students: any[]; total: number }>({
    queryKey: ["/api/students/search-dashboard", query],
    queryFn: async () => {
      if (!query.trim() || query.trim().length < 2) return { students: [], total: 0 };
      const res = await fetch(`/api/students?searchTerm=${encodeURIComponent(query.trim())}&limit=6`, {
        credentials: "include",
      });
      return res.json();
    },
    enabled: query.trim().length >= 2,
  });

  const results = data?.students || [];
  const showResults = query.trim().length >= 2;

  const handleGoToStudent = (id: number) => {
    setLocation(`/students/${id}`);
    setQuery("");
  };

  const handleFullSearch = () => {
    if (query.trim()) setLocation(`/students?search=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            className="pl-9 h-11 text-base border-gray-200 bg-white focus:border-[#ECC462] focus:ring-[#ECC462]/20"
            placeholder="Search students by name or email..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleFullSearch()}
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          onClick={handleFullSearch}
          className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium h-11 px-5"
        >
          Search
        </Button>
      </div>

      {/* Inline results dropdown */}
      {showResults && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden">
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-gray-500">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500">No students found for "{query}"</div>
          ) : (
            <>
              {results.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleGoToStudent(s.id)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 border-b border-gray-50 last:border-0 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.firstName} {s.lastName}</p>
                    <p className="text-xs text-gray-500">{s.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="text-xs capitalize bg-gray-100 text-gray-600 border-0">{s.courseType}</Badge>
                    <Badge className={`text-xs capitalize border-0 ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {s.status}
                    </Badge>
                  </div>
                </button>
              ))}
              {(data?.total || 0) > results.length && (
                <button
                  onClick={handleFullSearch}
                  className="w-full px-4 py-2.5 text-sm text-[#ECC462] hover:bg-gray-50 font-medium text-left border-t border-gray-100"
                >
                  View all {data?.total} results →
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Instructors Missing Availability ────────────────────────────────────────

function MissingAvailabilityWidget() {
  const [expanded, setExpanded] = useState(false);

  const { data: missing = [], isLoading } = useQuery<MissingAvailability[]>({
    queryKey: ["/api/admin/instructors-missing-availability"],
  });

  if (isLoading) {
    return (
      <Card className="border border-gray-200 shadow-sm bg-white">
        <CardContent className="p-5">
          <div className="animate-pulse h-16 bg-gray-100 rounded-md" />
        </CardContent>
      </Card>
    );
  }

  const hasMissing = missing.length > 0;

  return (
    <Card className={`border shadow-sm bg-white ${hasMissing ? "border-amber-200" : "border-gray-200"}`}>
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {hasMissing ? (
              <div className="p-1.5 bg-amber-50 rounded-md">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </div>
            ) : (
              <div className="p-1.5 bg-green-50 rounded-md">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </div>
            )}
            <div>
              <CardTitle className="text-sm font-semibold text-gray-900">Instructor Availability</CardTitle>
              <CardDescription className="text-xs text-gray-500 mt-0.5">
                {hasMissing
                  ? `${missing.length} instructor${missing.length > 1 ? "s haven't" : " hasn't"} set their availability`
                  : "All active instructors have set their availability"}
              </CardDescription>
            </div>
          </div>
          {hasMissing && (
            <button onClick={() => setExpanded(e => !e)} className="text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </CardHeader>

      {hasMissing && expanded && (
        <CardContent className="px-5 pb-4 pt-0">
          <div className="border-t border-gray-100 pt-3 space-y-1.5">
            {missing.map(inst => (
              <Link key={inst.id} href={`/instructors/${inst.id}`}>
                <div className="flex items-center justify-between py-1.5 px-3 rounded-md hover:bg-amber-50 cursor-pointer">
                  <span className="text-sm font-medium text-gray-800">{inst.firstName} {inst.lastName}</span>
                  <span className="text-xs text-gray-500">{inst.email}</span>
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── Registration Summary ─────────────────────────────────────────────────────

function RegistrationSummaryWidget() {
  const { data, isLoading } = useQuery<RegistrationSummary>({
    queryKey: ["/api/admin/registration-summary"],
  });

  const CourseBar = ({ label, value, total, color }: { label: string; value: number; total: number; color: string }) => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-12 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: total > 0 ? `${(value / total) * 100}%` : "0%" }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-4 text-right">{value}</span>
    </div>
  );

  const weekData = data?.thisWeek;
  const monthData = data?.thisMonth;

  return (
    <Card className="border border-gray-200 shadow-sm bg-white">
      <CardHeader className="pb-3 pt-4 px-5">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-[#ECC462]/10 rounded-md">
            <TrendingUp className="h-4 w-4 text-[#ECC462]" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-gray-900">Registration Summary</CardTitle>
            <CardDescription className="text-xs text-gray-500 mt-0.5">{data?.total || 0} active students total</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4 pt-0">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 bg-gray-100 rounded-md animate-pulse" />
            <div className="h-24 bg-gray-100 rounded-md animate-pulse" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {/* This week */}
            <div className="bg-gray-50 border border-gray-100 rounded-md p-3">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">This Week</p>
              <p className="text-2xl font-bold text-gray-900 mb-2">{weekData?.count || 0}</p>
              <div className="space-y-1">
                <CourseBar label="Auto" value={weekData?.auto || 0} total={weekData?.count || 1} color="bg-[#ECC462]" />
                <CourseBar label="Moto" value={weekData?.moto || 0} total={weekData?.count || 1} color="bg-gray-600" />
                <CourseBar label="Scoot" value={weekData?.scooter || 0} total={weekData?.count || 1} color="bg-gray-400" />
              </div>
            </div>
            {/* This month */}
            <div className="bg-gray-50 border border-gray-100 rounded-md p-3">
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">This Month</p>
              <p className="text-2xl font-bold text-gray-900 mb-2">{monthData?.count || 0}</p>
              <div className="space-y-1">
                <CourseBar label="Auto" value={monthData?.auto || 0} total={monthData?.count || 1} color="bg-[#ECC462]" />
                <CourseBar label="Moto" value={monthData?.moto || 0} total={monthData?.count || 1} color="bg-gray-600" />
                <CourseBar label="Scoot" value={monthData?.scooter || 0} total={monthData?.count || 1} color="bg-gray-400" />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Theory Class Attendance ──────────────────────────────────────────────────

function TheoryAttendanceWidget() {
  const today = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(today);
  const [expandedClass, setExpandedClass] = useState<number | null>(null);

  const { data, isLoading } = useQuery<TheoryAttendance>({
    queryKey: ["/api/admin/theory-attendance", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/admin/theory-attendance?date=${selectedDate}`, { credentials: "include" });
      return res.json();
    },
  });

  const statusColor = (status: string) => {
    switch (status) {
      case "present": return "bg-green-100 text-green-700";
      case "absent": return "bg-red-100 text-red-700";
      case "late": return "bg-amber-100 text-amber-700";
      default: return "bg-gray-100 text-gray-500";
    }
  };

  const classStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-green-100 text-green-700 border-green-200";
      case "scheduled": return "bg-blue-100 text-blue-700 border-blue-200";
      case "cancelled": return "bg-red-100 text-red-700 border-red-200";
      default: return "bg-gray-100 text-gray-600 border-gray-200";
    }
  };

  const courseLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <Card className="border border-gray-200 shadow-sm bg-white">
      <CardHeader className="border-b border-gray-100 pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-blue-50 rounded-md">
              <BookOpen className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-gray-900">Theory Class Attendance</CardTitle>
              <CardDescription className="text-xs text-gray-500 mt-0.5">
                {data?.classes.length || 0} theory class{data?.classes.length !== 1 ? "es" : ""} on this date
              </CardDescription>
            </div>
          </div>
          <input
            type="date"
            value={selectedDate}
            onChange={e => { setSelectedDate(e.target.value); setExpandedClass(null); }}
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-[#ECC462]"
          />
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4 pt-3">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-14 bg-gray-100 rounded-md animate-pulse" />)}
          </div>
        ) : !data?.classes.length ? (
          <div className="text-center py-8">
            <Calendar className="h-8 w-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No theory classes scheduled for this date</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.classes.map(cls => (
              <div key={cls.classId} className="border border-gray-100 rounded-md overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                  onClick={() => setExpandedClass(expandedClass === cls.classId ? null : cls.classId)}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-left">
                      <p className="text-sm font-semibold text-gray-900">
                        {courseLabel(cls.courseType)} Theory — Class {cls.classNumber}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {cls.time && cls.time.slice(0, 5)} · {cls.instructorName}
                        {cls.room && ` · ${cls.room}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-500">{cls.enrolledCount} student{cls.enrolledCount !== 1 ? "s" : ""}</span>
                    <Badge className={`text-xs capitalize border ${classStatusColor(cls.status)}`}>
                      {cls.status}
                    </Badge>
                    {expandedClass === cls.classId
                      ? <ChevronUp className="h-4 w-4 text-gray-400" />
                      : <ChevronDown className="h-4 w-4 text-gray-400" />
                    }
                  </div>
                </button>

                {expandedClass === cls.classId && (
                  <div className="border-t border-gray-100 bg-gray-50/50">
                    {cls.students.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-gray-400">No students enrolled</p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {cls.students.map(student => (
                          <div key={student.enrollmentId} className="flex items-center justify-between px-4 py-2.5">
                            <Link href={`/students/${student.studentId}`}>
                              <span className="text-sm text-gray-800 hover:text-[#111111] hover:underline cursor-pointer font-medium">
                                {student.studentName}
                              </span>
                            </Link>
                            <Badge className={`text-xs capitalize border-0 ${statusColor(student.attendanceStatus)}`}>
                              {student.attendanceStatus === "pending" ? "Not marked" : student.attendanceStatus}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="px-4 py-2 border-t border-gray-100">
                      <Link href={`/scheduling`}>
                        <span className="text-xs text-[#ECC462] hover:underline font-medium cursor-pointer">
                          Open full attendance sheet →
                        </span>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Class Scheduling Overview ────────────────────────────────────────────────

function ClassSchedulingOverview() {
  const [view, setView] = useState<"day" | "week">("week");

  const { data: overview, isLoading } = useQuery<ClassOverview>({
    queryKey: ["/api/dashboard/class-overview", view],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/class-overview?view=${view}`);
      return res.json();
    },
  });

  return (
    <Card className="border border-gray-200 shadow-sm bg-white">
      <CardHeader className="border-b border-gray-100 pb-3 pt-4 px-5">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-gray-900">Class Scheduling Overview</CardTitle>
            <CardDescription className="text-xs text-gray-500 mt-0.5">
              {view === "day" ? "Today's" : "This week's"} scheduled classes
            </CardDescription>
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setView("day")}
              className={`text-xs px-3 py-1 rounded font-medium transition-colors ${view === "day" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >Day</button>
            <button
              onClick={() => setView("week")}
              className={`text-xs px-3 py-1 rounded font-medium transition-colors ${view === "week" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >Week</button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4 pt-4">
        {isLoading ? (
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-md animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-4 rounded-md bg-gray-50 border border-gray-100 border-l-4 border-l-[#111111]">
              <p className="text-2xl font-bold text-gray-900">{overview?.total || 0}</p>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mt-1">Total</p>
            </div>
            <div className="text-center p-4 rounded-md bg-blue-50 border border-blue-100 border-l-4 border-l-blue-500">
              <p className="text-2xl font-bold text-blue-700">{overview?.theory || 0}</p>
              <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mt-1">Theory</p>
            </div>
            <div className="text-center p-4 rounded-md bg-[#ECC462]/5 border border-[#ECC462]/20 border-l-4 border-l-[#ECC462]">
              <p className="text-2xl font-bold text-amber-700">{overview?.driving || 0}</p>
              <p className="text-xs text-amber-600 font-medium uppercase tracking-wide mt-1">In-Car</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Welcome back — here's what's happening at Morty's Driving School today.</p>
      </div>

      {/* a) Big Student Search */}
      <Card className="border border-gray-200 shadow-sm bg-white mb-6">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-4 w-4 text-[#ECC462]" />
            <span className="text-sm font-semibold text-gray-700">Student Quick Search</span>
          </div>
          <StudentSearchWidget />
        </CardContent>
      </Card>

      {/* b + c: Availability alert + Registration summary side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <MissingAvailabilityWidget />
        <RegistrationSummaryWidget />
      </div>

      {/* d) Theory Class Attendance */}
      <div className="mb-6">
        <TheoryAttendanceWidget />
      </div>

      {/* Class scheduling overview */}
      <div className="mb-6">
        <ClassSchedulingOverview />
      </div>

      {/* Quick Actions */}
      <Card className="border border-gray-200 shadow-sm bg-white">
        <CardHeader className="border-b border-gray-100 pb-3 pt-4 px-5">
          <CardTitle className="text-sm font-semibold text-gray-900">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: "/students", icon: Plus, label: "Add Student" },
              { href: "/scheduling", icon: CalendarPlus, label: "Schedule Class" },
              { href: "/contracts", icon: FilePlus, label: "View Contracts" },
              { href: "/communications", icon: Send, label: "Send Message" },
            ].map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href}>
                <button className="w-full flex items-center gap-3 px-4 py-3 rounded-md border border-gray-200 bg-white hover:border-[#ECC462] hover:bg-[#ECC462]/5 transition-colors text-left">
                  <div className="p-1.5 bg-gray-100 rounded">
                    <Icon className="h-4 w-4 text-gray-600" />
                  </div>
                  <span className="text-sm font-medium text-gray-700">{label}</span>
                </button>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
