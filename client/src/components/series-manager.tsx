import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Repeat, Trash2, Users, AlertTriangle, CalendarDays } from "lucide-react";
import type { Class, Instructor } from "@shared/schema";

type SeriesClass = Class & {
  enrolledCount: number;
  enrolledStudents: { id: number; name: string }[];
};

type SeriesData = {
  seriesId: string;
  today: string;
  classes: SeriesClass[];
};

interface SeriesManagerProps {
  seriesId: string;
  anchorClass: Class; // the class the admin opened
  mode: "edit" | "delete" | "days";
  instructors: Instructor[];
  onClose: () => void;
}

export default function SeriesManager({ seriesId, anchorClass, mode, instructors, onClose }: SeriesManagerProps) {
  const { toast } = useToast();
  const [scope, setScope] = useState<"all" | "future">("all");
  const [selectedDays, setSelectedDays] = useState<number[] | null>(null);
  const [editForm, setEditForm] = useState({
    time: anchorClass.time || "",
    duration: anchorClass.duration || 120,
    instructorId: anchorClass.instructorId ? String(anchorClass.instructorId) : "none",
    maxStudents: anchorClass.maxStudents || 15,
    room: anchorClass.room || "",
    zoomLink: anchorClass.zoomLink || "",
  });

  const { data: series, isLoading } = useQuery<SeriesData>({
    queryKey: ["/api/class-series", seriesId],
    queryFn: () => apiRequest("GET", `/api/class-series/${seriesId}`),
  });

  const dayOf = (dateStr: string) => new Date(dateStr + "T00:00:00").getDay();

  // Current days of week the (upcoming, attached) series classes run on.
  const currentDays = useMemo(() => {
    if (!series) return [] as number[];
    const days = new Set<number>();
    for (const cls of series.classes) {
      if (cls.date < series.today || cls.detachedFromSeries || cls.status === "cancelled") continue;
      days.add(dayOf(cls.date));
    }
    return Array.from(days).sort();
  }, [series]);

  // Initialize the day picker with the series' current days once loaded.
  const effectiveDays = selectedDays ?? currentDays;

  // Compute affected classes exactly like the server does
  const affected = useMemo(() => {
    if (!series) return { classes: [] as SeriesClass[], skippedPast: 0, skippedDetached: 0, students: [] as { id: number; name: string }[] };
    const today = series.today;
    const cutoff = scope === "future" ? (anchorClass.date > today ? anchorClass.date : today) : today;
    const affectedClasses: SeriesClass[] = [];
    let skippedPast = 0;
    let skippedDetached = 0;
    const studentMap = new Map<number, string>();
    const daySet = new Set(effectiveDays);
    for (const cls of series.classes) {
      if (cls.date < cutoff) { skippedPast++; continue; }
      if ((mode === "edit" || mode === "days") && cls.detachedFromSeries) { skippedDetached++; continue; }
      if ((mode === "edit" || mode === "days") && cls.status === "cancelled") continue;
      if (mode === "days") {
        // Only classes on removed days are affected (moved/removed).
        if (daySet.has(dayOf(cls.date))) continue;
      }
      affectedClasses.push(cls);
      cls.enrolledStudents.forEach(s => studentMap.set(s.id, s.name));
    }
    return {
      classes: affectedClasses,
      skippedPast,
      skippedDetached,
      students: Array.from(studentMap, ([id, name]) => ({ id, name })),
    };
  }, [series, scope, anchorClass.date, mode, effectiveDays]);

  const editMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/class-series/${seriesId}`, {
        scope,
        fromDate: scope === "future" ? anchorClass.date : undefined,
        updates: {
          time: editForm.time,
          duration: editForm.duration,
          instructorId: editForm.instructorId === "none" ? null : parseInt(editForm.instructorId),
          maxStudents: editForm.maxStudents,
          room: editForm.room || null,
          zoomLink: editForm.zoomLink || null,
        },
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-series", seriesId] });
      toast({
        title: "Series Updated",
        description: `Updated ${data.updated} class${data.updated !== 1 ? "es" : ""}.${data.skippedDetached ? ` ${data.skippedDetached} individually edited class${data.skippedDetached !== 1 ? "es were" : " was"} left unchanged.` : ""}`,
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
      onClose();
    },
    onError: (err: any) => {
      const conflicts = err?.data?.conflicts;
      toast({
        title: conflicts?.length ? "Scheduling Conflict" : "Error",
        description: conflicts?.length
          ? `${err.data.message} ${conflicts.slice(0, 3).join("; ")}${conflicts.length > 3 ? "…" : ""}`
          : err?.data?.message || err?.message || "Failed to update series.",
        variant: "destructive",
      });
    },
  });

  const daysMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/class-series/${seriesId}/change-days`, {
        scope,
        fromDate: scope === "future" ? anchorClass.date : undefined,
        daysOfWeek: effectiveDays,
      }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/class-series", seriesId] });
      const parts = [
        `${data.created} class${data.created !== 1 ? "es" : ""} created`,
        `${data.deleted} removed`,
      ];
      if (data.moved?.length) parts.push(`${data.moved.length} student${data.moved.length !== 1 ? "s" : ""} moved`);
      if (data.needsAttention?.length) parts.push(`${data.needsAttention.length} student${data.needsAttention.length !== 1 ? "s" : ""} need${data.needsAttention.length === 1 ? "s" : ""} office follow-up`);
      toast({
        title: "Series Days Changed",
        description: parts.join(", ") + ".",
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
      onClose();
    },
    onError: (err: any) => {
      const conflicts = err?.data?.conflicts;
      toast({
        title: conflicts?.length ? "Scheduling Conflict" : "Error",
        description: conflicts?.length
          ? `${err.data.message} ${conflicts.slice(0, 3).join("; ")}${conflicts.length > 3 ? "…" : ""}`
          : err?.data?.message || err?.message || "Failed to change series days.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "DELETE",
        `/api/class-series/${seriesId}?scope=${scope}${scope === "future" ? `&fromDate=${anchorClass.date}` : ""}`
      ),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/classes"] });
      toast({
        title: "Series Deleted",
        description: `Removed ${data.deleted} class${data.deleted !== 1 ? "es" : ""} from the schedule.${data.affectedStudents?.length ? ` ${data.affectedStudents.length} enrolled student${data.affectedStudents.length !== 1 ? "s were" : " was"} notified.` : ""}`,
        className: "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] border-0",
      });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err?.message || "Failed to delete series.", variant: "destructive" });
    },
  });

  const isPending = editMutation.isPending || deleteMutation.isPending || daysMutation.isPending;

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const toggleDay = (d: number) => {
    const base = effectiveDays;
    const next = base.includes(d) ? base.filter(x => x !== d) : [...base, d].sort((a, b) => a - b);
    setSelectedDays(next);
  };
  const daysChanged =
    effectiveDays.length !== currentDays.length ||
    effectiveDays.some(d => !currentDays.includes(d));

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "edit" ? (
              <><Repeat className="h-5 w-5 text-[#ECC462]" /> Edit Recurring Series</>
            ) : mode === "days" ? (
              <><CalendarDays className="h-5 w-5 text-[#ECC462]" /> Change Series Days</>
            ) : (
              <><Trash2 className="h-5 w-5 text-red-500" /> Delete Recurring Series</>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Apply changes to every class in this recurring schedule. Past classes are never modified."
              : mode === "days"
              ? "Change which days of the week this series runs on. Upcoming classes on removed days are replaced with classes on the new days, and enrolled students are moved automatically where possible. Past classes are never modified."
              : "Remove classes in this recurring schedule. Past classes are never deleted."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-[#ECC462]" />
          </div>
        ) : (
          <div className="space-y-5 py-2">
            {/* Scope picker */}
            <div className="space-y-2">
              <Label>Apply to</Label>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as "all" | "future")} className="space-y-2">
                <label className="flex items-start gap-3 rounded-md border border-gray-200 p-3 cursor-pointer hover:border-[#ECC462]">
                  <RadioGroupItem value="all" id="scope-all" data-testid="radio-scope-all" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Entire series</p>
                    <p className="text-xs text-gray-500">All upcoming classes in the series (past classes are untouched)</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 rounded-md border border-gray-200 p-3 cursor-pointer hover:border-[#ECC462]">
                  <RadioGroupItem value="future" id="scope-future" data-testid="radio-scope-future" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">This and future classes</p>
                    <p className="text-xs text-gray-500">From {anchorClass.date} onward</p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            {/* Edit fields */}
            {mode === "edit" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Start Time</Label>
                    <Input
                      type="time"
                      value={editForm.time}
                      onChange={(e) => setEditForm(p => ({ ...p, time: e.target.value }))}
                      data-testid="input-series-time"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Duration</Label>
                    <Select value={String(editForm.duration)} onValueChange={(v) => setEditForm(p => ({ ...p, duration: parseInt(v) }))}>
                      <SelectTrigger data-testid="select-series-duration"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="60">60 min</SelectItem>
                        <SelectItem value="90">90 min</SelectItem>
                        <SelectItem value="120">120 min</SelectItem>
                        <SelectItem value="180">180 min</SelectItem>
                        <SelectItem value="240">240 min</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Instructor</Label>
                    <Select value={editForm.instructorId} onValueChange={(v) => setEditForm(p => ({ ...p, instructorId: v }))}>
                      <SelectTrigger data-testid="select-series-instructor"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Instructor</SelectItem>
                        {instructors.map(inst => (
                          <SelectItem key={inst.id} value={String(inst.id)}>
                            {inst.firstName} {inst.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max Students</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={editForm.maxStudents}
                      onChange={(e) => setEditForm(p => ({ ...p, maxStudents: parseInt(e.target.value) || 15 }))}
                      data-testid="input-series-max-students"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Room (Optional)</Label>
                  <Input
                    placeholder="e.g. Room A"
                    value={editForm.room}
                    onChange={(e) => setEditForm(p => ({ ...p, room: e.target.value }))}
                    data-testid="input-series-room"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Zoom Link (Optional)</Label>
                  <Input
                    placeholder="https://zoom.us/j/..."
                    value={editForm.zoomLink}
                    onChange={(e) => setEditForm(p => ({ ...p, zoomLink: e.target.value }))}
                    data-testid="input-series-zoom-link"
                  />
                </div>
              </div>
            )}

            {/* Days-of-week picker */}
            {mode === "days" && (
              <div className="space-y-2">
                <Label>Runs on</Label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, d) => {
                    const active = effectiveDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                          active
                            ? "bg-[#ECC462] border-[#ECC462] text-[#111111]"
                            : "bg-white border-gray-200 text-gray-600 hover:border-[#ECC462]"
                        }`}
                        data-testid={`button-day-${d}`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500">
                  Currently runs on: {currentDays.map(d => DAY_LABELS[d]).join(", ") || "—"}
                </p>
                {effectiveDays.length === 0 && (
                  <p className="text-xs text-red-600">Select at least one day.</p>
                )}
              </div>
            )}

            {/* Affected summary */}
            <div className={`rounded-lg border p-4 space-y-2 ${mode === "delete" ? "bg-red-50 border-red-200" : "bg-amber-50 border-[#ECC462]"}`}>
              <p className="text-sm font-semibold text-gray-900" data-testid="text-affected-summary">
                {mode === "edit" ? "Will update" : mode === "days" ? "Will move/replace" : "Will delete"} {affected.classes.length} class{affected.classes.length !== 1 ? "es" : ""}
                {affected.skippedPast > 0 && ` · ${affected.skippedPast} past class${affected.skippedPast !== 1 ? "es" : ""} untouched`}
                {affected.skippedDetached > 0 && ` · ${affected.skippedDetached} individually edited class${affected.skippedDetached !== 1 ? "es" : ""} skipped`}
              </p>
              {affected.classes.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {affected.classes.map(cls => (
                    <div key={cls.id} className="flex items-center justify-between text-xs text-gray-700" data-testid={`row-affected-class-${cls.id}`}>
                      <span>{cls.date} at {cls.time}</span>
                      <span className="flex items-center gap-2">
                        {cls.status === "cancelled" && <Badge variant="outline" className="text-[10px]">cancelled</Badge>}
                        {cls.enrolledCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-700 font-medium">
                            <Users className="h-3 w-3" /> {cls.enrolledCount} enrolled
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {affected.students.length > 0 && (
                <div className="pt-2 border-t border-gray-200">
                  <p className="text-xs font-semibold text-gray-800 flex items-center gap-1 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    {affected.students.length} enrolled student{affected.students.length !== 1 ? "s" : ""} will be notified:
                  </p>
                  <p className="text-xs text-gray-600" data-testid="text-affected-students">
                    {affected.students.map(s => s.name).join(", ")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} data-testid="button-series-cancel">
            Cancel
          </Button>
          {mode === "edit" ? (
            <Button
              className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
              disabled={isPending || isLoading || affected.classes.length === 0 || !editForm.time}
              onClick={() => editMutation.mutate()}
              data-testid="button-series-save"
            >
              {editMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</>
              ) : (
                <>Update {affected.classes.length} Class{affected.classes.length !== 1 ? "es" : ""}</>
              )}
            </Button>
          ) : mode === "days" ? (
            <Button
              className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium"
              disabled={isPending || isLoading || effectiveDays.length === 0 || !daysChanged}
              onClick={() => daysMutation.mutate()}
              data-testid="button-series-change-days"
            >
              {daysMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Changing Days...</>
              ) : (
                <>Change Days</>
              )}
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={isPending || isLoading || affected.classes.length === 0}
              onClick={() => deleteMutation.mutate()}
              data-testid="button-series-delete-confirm"
            >
              {deleteMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting...</>
              ) : (
                <><Trash2 className="mr-2 h-4 w-4" /> Delete {affected.classes.length} Class{affected.classes.length !== 1 ? "es" : ""}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
