import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Clock, User, Edit3, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface ZoomAttendance {
  id: number;
  zoomMeetingId: number;
  studentId: number;
  participantName: string;
  joinTime: string;
  leaveTime: string;
  duration: number;
  attendanceStatus: string;
  isManuallyAdjusted: boolean;
  adjustedBy: number | null;
  adjustmentReason: string | null;
  createdAt: string;
}

interface Student {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface ZoomAttendanceManagerProps {
  meetingId: number;
  classTitle: string;
}

export default function ZoomAttendanceManager({ meetingId, classTitle }: ZoomAttendanceManagerProps) {
  const [selectedAttendance, setSelectedAttendance] = useState<ZoomAttendance | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const { toast } = useToast();

  const { data: attendance = [], isLoading } = useQuery<ZoomAttendance[]>({
    queryKey: [`/api/zoom/meetings/${meetingId}/attendance`],
  });

  const adjustAttendanceMutation = useMutation({
    mutationFn: (data: { attendanceId: number; status: string; reason: string; adjustedBy: number }) =>
      apiRequest(`/api/zoom/attendance/${data.attendanceId}/adjust`, "PUT", {
        status: data.status,
        reason: data.reason,
        adjustedBy: data.adjustedBy, // In real app, get from auth context
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/zoom/meetings/${meetingId}/attendance`] });
      toast({
        title: "Attendance Adjusted",
        description: "Student attendance has been successfully updated.",
      });
      setSelectedAttendance(null);
      setAdjustmentReason("");
      setNewStatus("");
    },
    onError: () => {
      toast({
        title: "Adjustment Failed",
        description: "Failed to adjust attendance. Please try again.",
        variant: "destructive",
      });
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "present":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "partial":
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case "absent":
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  const getStatusBadge = (status: string, isAdjusted: boolean) => {
    const baseClass = "flex items-center gap-1";
    
    switch (status) {
      case "present":
        return (
          <Badge className={`${baseClass} bg-green-100 text-green-800 hover:bg-green-100`}>
            {getStatusIcon(status)}
            Present{isAdjusted && " (Adjusted)"}
          </Badge>
        );
      case "partial":
        return (
          <Badge className={`${baseClass} bg-yellow-100 text-yellow-800 hover:bg-yellow-100`}>
            {getStatusIcon(status)}
            Partial{isAdjusted && " (Adjusted)"}
          </Badge>
        );
      case "absent":
        return (
          <Badge className={`${baseClass} bg-red-100 text-red-800 hover:bg-red-100`}>
            {getStatusIcon(status)}
            Absent{isAdjusted && " (Adjusted)"}
          </Badge>
        );
      default:
        return (
          <Badge className={`${baseClass} bg-gray-100 text-gray-800 hover:bg-gray-100`}>
            {getStatusIcon(status)}
            Unknown{isAdjusted && " (Adjusted)"}
          </Badge>
        );
    }
  };

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const handleAdjustAttendance = () => {
    if (!selectedAttendance || !newStatus || !adjustmentReason.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a status and provide a reason for the adjustment.",
        variant: "destructive",
      });
      return;
    }

    adjustAttendanceMutation.mutate({
      attendanceId: selectedAttendance.id,
      status: newStatus,
      reason: adjustmentReason.trim(),
      adjustedBy: 1, // In real app, get from auth context
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Attendance Overview</h3>
          <p className="text-sm text-muted-foreground">{classTitle}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span>{attendance.filter(a => a.attendanceStatus === "present").length} Present</span>
          </div>
          <div className="flex items-center gap-1">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <span>{attendance.filter(a => a.attendanceStatus === "partial").length} Partial</span>
          </div>
          <div className="flex items-center gap-1">
            <XCircle className="h-4 w-4 text-red-600" />
            <span>{attendance.filter(a => a.attendanceStatus === "absent").length} Absent</span>
          </div>
        </div>
      </div>

      {attendance.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <User className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Attendance Data</h3>
            <p className="text-sm text-muted-foreground text-center">
              Attendance data will appear here after the Zoom meeting ends and the system processes the participant reports.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {attendance.map((record) => (
            <Card key={record.id} className="relative">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div>
                      <h4 className="font-semibold">{record.participantName}</h4>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{formatTime(record.joinTime)} - {formatTime(record.leaveTime)}</span>
                        </div>
                        <span>Duration: {formatDuration(record.duration)}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {getStatusBadge(record.attendanceStatus, record.isManuallyAdjusted)}
                    
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedAttendance(record);
                            setNewStatus(record.attendanceStatus);
                            setAdjustmentReason(record.adjustmentReason || "");
                          }}
                        >
                          <Edit3 className="h-4 w-4" />
                          Adjust
                        </Button>
                      </DialogTrigger>
                      
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Adjust Attendance</DialogTitle>
                          <DialogDescription>
                            Manually adjust the attendance status for {record.participantName}
                          </DialogDescription>
                        </DialogHeader>
                        
                        <div className="space-y-4">
                          <div>
                            <Label>Current Status</Label>
                            <div className="mt-1">
                              {getStatusBadge(record.attendanceStatus, record.isManuallyAdjusted)}
                            </div>
                          </div>
                          
                          <div>
                            <Label htmlFor="new-status">New Status</Label>
                            <Select value={newStatus} onValueChange={setNewStatus}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select new status" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="present">Present</SelectItem>
                                <SelectItem value="partial">Partial</SelectItem>
                                <SelectItem value="absent">Absent</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div>
                            <Label htmlFor="reason">Reason for Adjustment</Label>
                            <Textarea
                              id="reason"
                              value={adjustmentReason}
                              onChange={(e) => setAdjustmentReason(e.target.value)}
                              placeholder="Explain why this attendance is being adjusted..."
                              className="mt-1"
                            />
                          </div>
                          
                          {record.isManuallyAdjusted && record.adjustmentReason && (
                            <div className="p-3 bg-muted rounded-lg">
                              <Label className="text-sm font-medium">Previous Adjustment</Label>
                              <p className="text-sm text-muted-foreground mt-1">
                                {record.adjustmentReason}
                              </p>
                            </div>
                          )}
                          
                          <div className="flex justify-end gap-3">
                            <Button
                              variant="outline"
                              onClick={() => {
                                setSelectedAttendance(null);
                                setNewStatus("");
                                setAdjustmentReason("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleAdjustAttendance}
                              disabled={adjustAttendanceMutation.isPending}
                            >
                              {adjustAttendanceMutation.isPending ? "Adjusting..." : "Adjust Attendance"}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}