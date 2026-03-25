import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { 
  Calendar, 
  Clock, 
  Car,
  Bike,
  ChevronLeft,
  MapPin,
  User,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileText,
  Filter,
  History,
  Star,
  BookOpen,
  ClipboardCheck,
  LogIn,
  LogOut,
  PenTool
} from "lucide-react";
import { useLocation } from "wouter";
import { useStudentAuth } from "@/hooks/useStudentAuth";
import { useState } from "react";
import { format } from "date-fns";

interface HistoryEntry {
  id: string;
  type: 'lesson' | 'evaluation';
  date: string;
  time?: string;
  timestamp: string;
  title: string;
  description: string;
  status: string;
  instructor?: {
    id: number;
    firstName: string;
    lastName: string;
  } | null;
  classType?: string;
  attendanceStatus?: string;
  checkInAt?: string;
  checkOutAt?: string;
  checkInSignature?: boolean;
  checkOutSignature?: boolean;
  room?: string;
  classId?: number;
  enrollmentId?: number;
  classNumber?: number;
  courseType?: string;
  sessionType?: string;
  overallRating?: number;
  strengths?: string[];
  weaknesses?: string[];
  notes?: string;
  signedOff?: boolean;
  evaluationId?: number;
}

interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
  lessonCount: number;
  evaluationCount: number;
  hasMore: boolean;
}

const getCourseIcon = (courseType: string) => {
  switch (courseType?.toLowerCase()) {
    case 'auto':
      return <Car className="h-4 w-4" />;
    case 'moto':
      return <Bike className="h-4 w-4" />;
    case 'scooter':
      return <Bike className="h-4 w-4" />;
    default:
      return <Car className="h-4 w-4" />;
  }
};

const getStatusBadge = (entry: HistoryEntry) => {
  if (entry.type === 'lesson') {
    switch (entry.status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 border-green-300"><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge>;
      case 'cancelled':
        return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Cancelled</Badge>;
      case 'missed':
        return <Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Missed</Badge>;
      case 'upcoming':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300"><Clock className="mr-1 h-3 w-3" />Upcoming</Badge>;
      case 'past':
        return <Badge className="bg-gray-100 text-gray-800 border-gray-300"><Clock className="mr-1 h-3 w-3" />Past</Badge>;
      default:
        return <Badge variant="secondary">{entry.status}</Badge>;
    }
  } else if (entry.type === 'evaluation') {
    if (entry.signedOff) {
      return <Badge className="bg-green-100 text-green-800 border-green-300"><CheckCircle2 className="mr-1 h-3 w-3" />Signed Off</Badge>;
    }
    return <Badge className="bg-amber-100 text-amber-800 border-amber-300"><AlertCircle className="mr-1 h-3 w-3" />Pending</Badge>;
  }
  return null;
};

const getEntryIcon = (entry: HistoryEntry) => {
  if (entry.type === 'lesson') {
    if (entry.classType === 'theory') {
      return <BookOpen className="h-5 w-5" />;
    }
    return getCourseIcon(entry.courseType || 'auto');
  } else if (entry.type === 'evaluation') {
    return <ClipboardCheck className="h-5 w-5" />;
  }
  return <FileText className="h-5 w-5" />;
};

export default function StudentHistory() {
  const [, setLocation] = useLocation();
  const { student, isLoading: authLoading } = useStudentAuth();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);

  const buildQueryUrl = () => {
    const params = new URLSearchParams();
    if (typeFilter !== 'all') params.append('type', typeFilter);
    if (statusFilter !== 'all') params.append('status', statusFilter);
    const queryString = params.toString();
    return queryString ? `/api/student/history?${queryString}` : '/api/student/history';
  };

  const { data: historyData, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['/api/student/history', typeFilter, statusFilter],
    queryFn: async () => {
      const res = await fetch(buildQueryUrl(), { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch history');
      return res.json();
    },
    enabled: !!student,
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!student) {
    setLocation('/student/login');
    return null;
  }

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`h-4 w-4 ${
              star <= rating
                ? 'fill-amber-400 text-amber-400'
                : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-md shadow-sm p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-gray-600 hover:text-gray-900"
              onClick={() => setLocation('/student/classes')}
              data-testid="button-back"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <div className="bg-gray-50 rounded-md p-2 border border-gray-100">
                <History className="h-6 w-6 text-[#ECC462]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">My Learning History</h1>
                <p className="text-sm text-gray-600">View all your lessons, evaluations, and records</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {historyData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="stat-card" data-testid="card-total">
              <CardContent className="p-0">
                <p className="text-sm font-medium text-gray-600">Total Records</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{historyData.total}</p>
              </CardContent>
            </Card>
            <Card className="stat-card border-l-blue-500" data-testid="card-lessons">
              <CardContent className="p-0">
                <p className="text-sm font-medium text-gray-600">Lessons</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{historyData.lessonCount}</p>
              </CardContent>
            </Card>
            <Card className="stat-card border-l-purple-500" data-testid="card-evaluations">
              <CardContent className="p-0">
                <p className="text-sm font-medium text-gray-600">Evaluations</p>
                <p className="text-3xl font-bold text-purple-600 mt-1">{historyData.evaluationCount}</p>
              </CardContent>
            </Card>
          </div>
        )}

        <Card className="bg-white border border-gray-200 rounded-md shadow-sm" data-testid="card-filters">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Filter By:</span>
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[160px] rounded-md" data-testid="select-type">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="lesson">Lessons Only</SelectItem>
                  <SelectItem value="evaluation">Evaluations Only</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px] rounded-md" data-testid="select-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-md" />
            ))}
          </div>
        ) : historyData?.entries.length === 0 ? (
          <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
            <CardContent className="p-12 text-center">
              <History className="h-16 w-16 text-gray-200 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No History Found</h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'No records match your current filters. Try adjusting them.'
                  : "You don't have any lessons or evaluations yet. Book your first class to get started!"}
              </p>
              {typeFilter === 'all' && statusFilter === 'all' && (
                <Button
                  className="mt-6 bg-[#ECC462] text-[#111111] hover:bg-[#d4b055] font-semibold px-8"
                  onClick={() => setLocation('/student/book')}
                  data-testid="button-book-first"
                >
                  Book Your First Class
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {historyData?.entries.map((entry) => (
              <Card 
                key={entry.id} 
                className="bg-white border border-gray-200 rounded-md shadow-sm hover:border-[#ECC462] transition-colors cursor-pointer"
                onClick={() => setSelectedEntry(entry)}
                data-testid={`card-entry-${entry.id}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className={`p-3 rounded-md border shrink-0 ${
                      entry.type === 'lesson' 
                        ? entry.classType === 'theory' 
                          ? 'bg-blue-50 text-blue-700 border-blue-100' 
                          : 'bg-green-50 text-green-700 border-green-100'
                        : 'bg-purple-50 text-purple-700 border-purple-100'
                    }`}>
                      {getEntryIcon(entry)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <h3 className="font-semibold text-lg text-gray-900 truncate">{entry.title}</h3>
                          <p className="text-sm text-gray-600 mt-0.5 truncate">{entry.description}</p>
                        </div>
                        {getStatusBadge(entry)}
                      </div>
                      <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          {format(new Date(entry.date), 'MMM d, yyyy')}
                        </div>
                        {entry.time && (
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-4 w-4 text-gray-400" />
                            {formatTime(entry.time)}
                          </div>
                        )}
                        {entry.instructor && (
                          <div className="flex items-center gap-1.5">
                            <User className="h-4 w-4 text-gray-400" />
                            {entry.instructor.firstName} {entry.instructor.lastName}
                          </div>
                        )}
                        {entry.room && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-gray-400" />
                            {entry.room}
                          </div>
                        )}
                        {entry.overallRating && (
                          <div className="flex items-center gap-1.5">
                            {renderStars(entry.overallRating)}
                          </div>
                        )}
                      </div>
                      {entry.type === 'lesson' && (entry.checkInAt || entry.checkOutAt) && (
                        <div className="flex gap-4 mt-4 pt-4 border-t border-gray-50 text-xs text-gray-500">
                          {entry.checkInAt && (
                            <div className="flex items-center gap-1.5 bg-green-50/50 px-2 py-1 rounded-sm text-green-700">
                              <LogIn className="h-3 w-3" />
                              Checked in: {format(new Date(entry.checkInAt), 'h:mm a')}
                              {entry.checkInSignature && <PenTool className="h-3 w-3" />}
                            </div>
                          )}
                          {entry.checkOutAt && (
                            <div className="flex items-center gap-1.5 bg-blue-50/50 px-2 py-1 rounded-sm text-blue-700">
                              <LogOut className="h-3 w-3" />
                              Checked out: {format(new Date(entry.checkOutAt), 'h:mm a')}
                              {entry.checkOutSignature && <PenTool className="h-3 w-3" />}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selectedEntry} onOpenChange={() => setSelectedEntry(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedEntry && getEntryIcon(selectedEntry)}
              {selectedEntry?.title}
            </DialogTitle>
            <DialogDescription>
              {selectedEntry?.type === 'lesson' ? 'Lesson Details' : 'Evaluation Details'}
            </DialogDescription>
          </DialogHeader>
          
          {selectedEntry && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  {getStatusBadge(selectedEntry)}
                  {selectedEntry.type === 'lesson' && selectedEntry.classType && (
                    <Badge variant="outline" className="capitalize">
                      {selectedEntry.classType} Class
                    </Badge>
                  )}
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Date</span>
                    <p className="font-medium">{format(new Date(selectedEntry.date), 'MMMM d, yyyy')}</p>
                  </div>
                  {selectedEntry.time && (
                    <div>
                      <span className="text-gray-500">Time</span>
                      <p className="font-medium">{formatTime(selectedEntry.time)}</p>
                    </div>
                  )}
                  {selectedEntry.instructor && (
                    <div>
                      <span className="text-gray-500">Instructor</span>
                      <p className="font-medium">{selectedEntry.instructor.firstName} {selectedEntry.instructor.lastName}</p>
                    </div>
                  )}
                  {selectedEntry.room && (
                    <div>
                      <span className="text-gray-500">Location</span>
                      <p className="font-medium">{selectedEntry.room}</p>
                    </div>
                  )}
                  {selectedEntry.courseType && (
                    <div>
                      <span className="text-gray-500">Course Type</span>
                      <p className="font-medium capitalize">{selectedEntry.courseType}</p>
                    </div>
                  )}
                  {selectedEntry.classNumber && (
                    <div>
                      <span className="text-gray-500">Class Number</span>
                      <p className="font-medium">{selectedEntry.classNumber}</p>
                    </div>
                  )}
                </div>

                {selectedEntry.type === 'lesson' && (
                  <>
                    <Separator />
                    <div>
                      <h4 className="font-medium mb-2">Attendance</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Status</span>
                          <Badge variant="outline" className="capitalize">
                            {selectedEntry.attendanceStatus || 'Not recorded'}
                          </Badge>
                        </div>
                        {selectedEntry.checkInAt && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500 flex items-center gap-1">
                              <LogIn className="h-4 w-4" /> Check-in
                            </span>
                            <span className="flex items-center gap-1">
                              {format(new Date(selectedEntry.checkInAt), 'h:mm a')}
                              {selectedEntry.checkInSignature && (
                                <PenTool className="h-4 w-4 text-green-600" />
                              )}
                            </span>
                          </div>
                        )}
                        {selectedEntry.checkOutAt && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500 flex items-center gap-1">
                              <LogOut className="h-4 w-4" /> Check-out
                            </span>
                            <span className="flex items-center gap-1">
                              {format(new Date(selectedEntry.checkOutAt), 'h:mm a')}
                              {selectedEntry.checkOutSignature && (
                                <PenTool className="h-4 w-4 text-green-600" />
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {selectedEntry.type === 'evaluation' && (
                  <>
                    <Separator />
                    {selectedEntry.overallRating && (
                      <div>
                        <h4 className="font-medium mb-2">Overall Rating</h4>
                        {renderStars(selectedEntry.overallRating)}
                      </div>
                    )}
                    {selectedEntry.strengths && selectedEntry.strengths.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2 flex items-center gap-1">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          Strengths
                        </h4>
                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                          {selectedEntry.strengths.map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedEntry.weaknesses && selectedEntry.weaknesses.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2 flex items-center gap-1">
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                          Areas for Improvement
                        </h4>
                        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                          {selectedEntry.weaknesses.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedEntry.notes && (
                      <div>
                        <h4 className="font-medium mb-2">Instructor Notes</h4>
                        <p className="text-sm text-gray-700">{selectedEntry.notes}</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
