import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ClipboardCheck, Calendar, User, Filter, Search, Clock, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import type { AttendanceAuditLog, Instructor } from "@shared/schema";

interface AttendanceLogWithDetails extends AttendanceAuditLog {
  studentName?: string | null;
  classInfo?: string | null;
}

const actionLabels: Record<string, string> = {
  mark_complete: "Mark Complete",
  bulk_attendance: "Attendance Submit",
  check_in: "Check-In",
  check_out: "Check-Out",
  no_show: "No-Show",
  reset_attendance: "Attendance Reset",
};

const statusLabels: Record<string, string> = {
  registered: "Registered",
  checked_in: "Checked In",
  attended: "Attended",
  absent: "Absent",
  "no-show": "No-Show",
  scheduled: "Scheduled",
  completed: "Completed",
};

export default function AttendanceAuditLogs() {
  const [filters, setFilters] = useState({
    instructorId: "",
    classId: "",
    startDate: "",
    endDate: "",
    outcome: "",
    action: "",
  });

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.instructorId) params.append("instructorId", filters.instructorId);
    if (filters.classId) params.append("classId", filters.classId);
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.outcome) params.append("outcome", filters.outcome);
    if (filters.action) params.append("action", filters.action);
    const queryString = params.toString();
    return queryString ? `/api/attendance-audit-logs?${queryString}` : "/api/attendance-audit-logs";
  };

  const { data: logs = [], isLoading, error } = useQuery<AttendanceLogWithDetails[]>({
    queryKey: ["/api/attendance-audit-logs", filters],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl(), { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch attendance audit logs");
      return response.json();
    },
  });

  const { data: instructors = [] } = useQuery<Instructor[]>({
    queryKey: ["/api/instructors"],
  });

  const handleClearFilters = () => {
    setFilters({ instructorId: "", classId: "", startDate: "", endDate: "", outcome: "", action: "" });
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "N/A";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "Invalid date";
    }
  };

  const getInstructorName = (log: AttendanceLogWithDetails) => {
    if (log.actorType === "instructor") return log.actorName || `Instructor #${log.actorId}`;
    const instructor = instructors.find(i => i.id === log.instructorId);
    return instructor ? `${instructor.firstName} ${instructor.lastName}` : log.instructorId ? `Instructor #${log.instructorId}` : "N/A";
  };

  const blockedCount = logs.filter(l => l.outcome === "blocked").length;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ClipboardCheck className="h-8 w-8 text-[#ECC462]" />
            Attendance Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1">
            Review every attendance and class-completion action, including blocked early attempts
          </p>
        </div>
        <div className="flex items-center gap-3">
          {blockedCount > 0 && (
            <Badge variant="destructive" className="text-sm px-3 py-1.5" data-testid="badge-blocked-count">
              <ShieldAlert className="h-4 w-4 mr-1" />
              {blockedCount} Blocked
            </Badge>
          )}
          <Badge variant="outline" className="text-lg px-4 py-2" data-testid="badge-record-count">
            {logs.length} Records
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          <CardDescription>Filter by instructor, class, date range, action, or outcome</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <User className="h-4 w-4" /> Instructor
              </label>
              <Select
                value={filters.instructorId}
                onValueChange={(value) => setFilters(f => ({ ...f, instructorId: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-instructor">
                  <SelectValue placeholder="All Instructors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Instructors</SelectItem>
                  {instructors.map(instructor => (
                    <SelectItem key={instructor.id} value={instructor.id.toString()}>
                      {instructor.firstName} {instructor.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Search className="h-4 w-4" /> Class ID
              </label>
              <Input
                type="number"
                placeholder="Class #"
                value={filters.classId}
                onChange={(e) => setFilters(f => ({ ...f, classId: e.target.value }))}
                data-testid="input-filter-class-id"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Calendar className="h-4 w-4" /> Start Date
              </label>
              <Input
                type="date"
                value={filters.startDate}
                onChange={(e) => setFilters(f => ({ ...f, startDate: e.target.value }))}
                data-testid="input-filter-start-date"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Calendar className="h-4 w-4" /> End Date
              </label>
              <Input
                type="date"
                value={filters.endDate}
                onChange={(e) => setFilters(f => ({ ...f, endDate: e.target.value }))}
                data-testid="input-filter-end-date"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <ClipboardCheck className="h-4 w-4" /> Action
              </label>
              <Select
                value={filters.action}
                onValueChange={(value) => setFilters(f => ({ ...f, action: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-action">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="mark_complete">Mark Complete</SelectItem>
                  <SelectItem value="bulk_attendance">Attendance Submit</SelectItem>
                  <SelectItem value="check_in">Check-In</SelectItem>
                  <SelectItem value="check_out">Check-Out</SelectItem>
                  <SelectItem value="no_show">No-Show</SelectItem>
                  <SelectItem value="reset_attendance">Attendance Reset</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <ShieldAlert className="h-4 w-4" /> Outcome
              </label>
              <Select
                value={filters.outcome}
                onValueChange={(value) => setFilters(f => ({ ...f, outcome: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-outcome">
                  <SelectValue placeholder="All Outcomes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Outcomes</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={handleClearFilters} data-testid="button-clear-filters">
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Attendance Action History
          </CardTitle>
          <CardDescription>
            Complete audit trail of attendance and completion actions, with before/after status
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading audit logs...</div>
          ) : error ? (
            <div className="text-center py-8 text-red-500">
              Failed to load audit logs. Please try refreshing the page.
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-logs">
              No attendance audit logs found. Attendance and completion actions will appear here.
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Instructor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Before → After</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-attendance-log-${log.id}`}>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm">{formatDate(log.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{log.actorName || `#${log.actorId}`}</div>
                        <div className="text-xs text-muted-foreground capitalize">{log.actorType}</div>
                      </TableCell>
                      <TableCell>{getInstructorName(log)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50">
                          {actionLabels[log.action] || log.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {log.classInfo ? (
                          <div className="text-sm">{log.classInfo}</div>
                        ) : log.classId ? (
                          `Class #${log.classId}`
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                      <TableCell>{log.studentName || (log.studentId ? `Student #${log.studentId}` : "—")}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-red-600">{log.previousStatus ? (statusLabels[log.previousStatus] || log.previousStatus) : "—"}</span>
                        {" → "}
                        <span className="text-green-600">{log.newStatus ? (statusLabels[log.newStatus] || log.newStatus) : "—"}</span>
                      </TableCell>
                      <TableCell>
                        {log.outcome === "blocked" ? (
                          <Badge variant="destructive" data-testid={`badge-outcome-${log.id}`}>Blocked</Badge>
                        ) : (
                          <Badge variant="default" className="bg-green-100 text-green-800" data-testid={`badge-outcome-${log.id}`}>Success</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate text-sm" title={log.blockReason || log.details || undefined}>
                          {log.blockReason || log.details || "—"}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Card className="bg-amber-50 border-amber-200">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <ShieldAlert className="h-6 w-6 text-amber-600 mt-1" />
            <div>
              <h3 className="font-semibold text-amber-800">Compliance Information</h3>
              <p className="text-sm text-amber-700 mt-1">
                Every attendance and class-completion action is recorded here, including attempts that were
                blocked because they happened before the class's scheduled start time. Check-in opens 15 minutes
                before the scheduled start; all other actions require the start time to have passed.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
