import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Shield, Search, Calendar, User, FileText, Mail, Clock, Filter, Download } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { PolicyOverrideLog, Student, User as UserType } from "@shared/schema";

interface OverrideLogWithDetails extends PolicyOverrideLog {
  staffUser?: UserType;
  student?: Student;
  className?: string;
}

const actionTypeLabels: Record<string, string> = {
  book: "Booking",
  edit: "Edit",
  cancel: "Cancellation",
  reschedule: "Reschedule"
};

const policyTypeLabels: Record<string, string> = {
  max_duration: "Max Duration",
  max_bookings_per_day: "Max Bookings/Day",
  max_bookings_per_week: "Max Bookings/Week",
  advance_booking_days: "Advance Booking Days",
  min_booking_notice: "Min Notice"
};

export default function OverrideAuditLogs() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    staffUserId: "",
    studentId: "",
    startDate: "",
    endDate: "",
    policyType: "",
    actionType: ""
  });

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (filters.staffUserId) params.append("staffUserId", filters.staffUserId);
    if (filters.studentId) params.append("studentId", filters.studentId);
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.policyType) params.append("policyType", filters.policyType);
    if (filters.actionType) params.append("actionType", filters.actionType);
    const queryString = params.toString();
    return queryString ? `/api/policy-override-logs?${queryString}` : "/api/policy-override-logs";
  };

  const { data: overrideLogs = [], isLoading: logsLoading, error: logsError } = useQuery<OverrideLogWithDetails[]>({
    queryKey: ["/api/policy-override-logs", filters],
    queryFn: async () => {
      const response = await fetch(buildQueryUrl(), { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch audit logs');
      return response.json();
    }
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<UserType[]>({
    queryKey: ["/api/users"],
  });

  const { data: studentsResponse, isLoading: studentsLoading } = useQuery<{ students: Student[] }>({
    queryKey: ["/api/students"],
  });

  const students = studentsResponse?.students || [];

  const handleClearFilters = () => {
    setFilters({
      staffUserId: "",
      studentId: "",
      startDate: "",
      endDate: "",
      policyType: "",
      actionType: ""
    });
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return "N/A";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "Invalid date";
    }
  };

  const getStaffName = (log: OverrideLogWithDetails) => {
    if (log.staffUser) {
      return `${log.staffUser.firstName || ""} ${log.staffUser.lastName || ""}`.trim() || log.staffUser.email || "Unknown";
    }
    const user = users.find(u => u.id === log.staffUserId);
    if (user) {
      return `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email || "Unknown";
    }
    return log.staffUserId || "Unknown";
  };

  const getStudentName = (log: OverrideLogWithDetails) => {
    if (log.student) {
      return `${log.student.firstName} ${log.student.lastName}`;
    }
    const student = students.find(s => s.id === log.studentId);
    if (student) {
      return `${student.firstName} ${student.lastName}`;
    }
    return log.studentId ? `Student #${log.studentId}` : "N/A";
  };

  const handleExportCSV = () => {
    if (overrideLogs.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no audit logs to export.",
        variant: "destructive"
      });
      return;
    }

    const headers = [
      "Date/Time",
      "Staff Member",
      "Student",
      "Class ID",
      "Action Type",
      "Policy Type",
      "Original Value",
      "Override Value",
      "Reason",
      "Notification Sent",
      "Notification Recipients"
    ];

    const csvRows = [headers.join(",")];

    overrideLogs.forEach(log => {
      const row = [
        formatDate(log.createdAt),
        `"${getStaffName(log).replace(/"/g, '""')}"`,
        `"${getStudentName(log).replace(/"/g, '""')}"`,
        log.classId || "",
        actionTypeLabels[log.actionType] || log.actionType,
        policyTypeLabels[log.policyType] || log.policyType,
        log.originalValue || "",
        log.overriddenValue || "",
        `"${(log.reason || "").replace(/"/g, '""')}"`,
        log.notificationSent ? "Yes" : "No",
        `"${(log.notificationRecipients || "").replace(/"/g, '""')}"`
      ];
      csvRows.push(row.join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `override-audit-logs-${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${overrideLogs.length} audit log records to CSV.`
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Shield className="h-8 w-8 text-[#ECC462]" />
            Policy Override Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1">
            Review and track all booking policy overrides for compliance purposes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleExportCSV}
            disabled={overrideLogs.length === 0}
            className="flex items-center gap-2"
            data-testid="button-export-csv"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Badge variant="outline" className="text-lg px-4 py-2">
            {overrideLogs.length} Records
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
          <CardDescription>Filter audit logs by staff, student, date range, or policy type</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <User className="h-4 w-4" /> Staff Member
              </label>
              <Select
                value={filters.staffUserId}
                onValueChange={(value) => setFilters(f => ({ ...f, staffUserId: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-staff">
                  <SelectValue placeholder="All Staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  {users.filter(u => u.role === "admin" || u.canOverrideBookingPolicies).map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.firstName} {user.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <User className="h-4 w-4" /> Student
              </label>
              <Select
                value={filters.studentId}
                onValueChange={(value) => setFilters(f => ({ ...f, studentId: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-student">
                  <SelectValue placeholder="All Students" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Students</SelectItem>
                  {students.map(student => (
                    <SelectItem key={student.id} value={student.id.toString()}>
                      {student.firstName} {student.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <FileText className="h-4 w-4" /> Policy Type
              </label>
              <Select
                value={filters.policyType}
                onValueChange={(value) => setFilters(f => ({ ...f, policyType: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-policy-type">
                  <SelectValue placeholder="All Policies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Policies</SelectItem>
                  <SelectItem value="max_duration">Max Duration</SelectItem>
                  <SelectItem value="max_bookings_per_day">Max Bookings/Day</SelectItem>
                  <SelectItem value="max_bookings_per_week">Max Bookings/Week</SelectItem>
                  <SelectItem value="advance_booking_days">Advance Booking Days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Search className="h-4 w-4" /> Action Type
              </label>
              <Select
                value={filters.actionType}
                onValueChange={(value) => setFilters(f => ({ ...f, actionType: value === "all" ? "" : value }))}
              >
                <SelectTrigger data-testid="select-filter-action-type">
                  <SelectValue placeholder="All Actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="book">Booking</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                  <SelectItem value="cancel">Cancellation</SelectItem>
                  <SelectItem value="reschedule">Reschedule</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="outline"
              onClick={handleClearFilters}
              data-testid="button-clear-filters"
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Override History
          </CardTitle>
          <CardDescription>
            Complete audit trail of all policy overrides with staff attribution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading audit logs...
            </div>
          ) : logsError ? (
            <div className="text-center py-8 text-red-500">
              Failed to load audit logs. Please try refreshing the page.
            </div>
          ) : overrideLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No override logs found. Override actions will appear here when staff members override booking policies.
            </div>
          ) : (
            <ScrollArea className="h-[600px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Staff Member</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Original Value</TableHead>
                    <TableHead>Override Value</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Notification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrideLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-audit-log-${log.id}`}>
                      <TableCell className="whitespace-nowrap">
                        <div className="text-sm">{formatDate(log.createdAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{getStaffName(log)}</div>
                      </TableCell>
                      <TableCell>
                        <div>{getStudentName(log)}</div>
                        {log.classId && (
                          <div className="text-xs text-muted-foreground">Class #{log.classId}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-blue-50">
                          {actionTypeLabels[log.actionType] || log.actionType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {policyTypeLabels[log.policyType] || log.policyType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-red-600">
                        {log.originalValue || "N/A"}
                      </TableCell>
                      <TableCell className="text-green-600">
                        {log.overriddenValue || "N/A"}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="truncate" title={log.reason}>
                          {log.reason || "No reason provided"}
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.notificationSent ? (
                          <Badge variant="default" className="bg-green-100 text-green-800">
                            <Mail className="h-3 w-3 mr-1" />
                            Sent
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-500">
                            Not Sent
                          </Badge>
                        )}
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
            <Shield className="h-6 w-6 text-amber-600 mt-1" />
            <div>
              <h3 className="font-semibold text-amber-800">Compliance Information</h3>
              <p className="text-sm text-amber-700 mt-1">
                This audit log tracks all instances where staff members have overridden booking policies.
                Each entry includes the staff member responsible, the reason provided, and notification status.
                These records are retained for compliance and accountability purposes.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
