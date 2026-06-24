import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Download, 
  Upload, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  Users, 
  Database,
  PlayCircle,
  StopCircle,
  TestTube,
  FileJson,
  RefreshCw,
  Loader2,
  FolderOpen
} from "lucide-react";

interface MigrationProgress {
  inProgress: boolean;
  totalStudents: number;
  processedStudents: number;
  currentLetter: string;
  errors: string[];
  estimatedTimeRemaining: string | null;
}

interface MigrationStats {
  totalMigratedStudents: number;
  migrationDate: string | null;
  errors: string[];
  duration: string | null;
}

interface ImportManifest {
  dataDir: string;
  exists: boolean;
  total: number;
  byType: Record<string, number>;
  alreadyImported: number;
}

interface EntityCounts {
  created: number;
  updated: number;
  skipped: number;
}

interface ImportStatus {
  status: "idle" | "running" | "completed" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  processed: number;
  currentFile: string | null;
  logs: string[];
  summary: {
    students: EntityCounts;
    contracts: EntityCounts;
    transactions: EntityCounts;
    evaluations: EntityCounts;
    lessons: EntityCounts;
    notes: EntityCounts;
    documents: EntityCounts;
    pages: { processed: number; skipped: number; errors: number };
  };
  error: string | null;
}

const PAGE_TYPE_LABELS: Record<string, string> = {
  studentfile: "Student Files",
  printcontracts: "Contracts (print)",
  registrations: "Registrations",
  coursetransfer: "Course Transfer / Phase",
  onlinetest: "Online Tests",
  practicalsignatures: "Driving Sign-ins",
  practicaleval: "Driving Evaluations",
  zoomscreenshot: "Zoom Screenshots",
  attestation: "Attestations",
  other: "Other",
};

export default function DataMigration() {
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const [showCredentials, setShowCredentials] = useState(false);
  const { toast } = useToast();

  // Get migration progress
  const { data: progress, refetch: refetchProgress } = useQuery<MigrationProgress>({
    queryKey: ["/api/migration/progress"],
    refetchInterval: 5000,
  });

  // Get migration statistics
  const { data: stats } = useQuery<MigrationStats>({
    queryKey: ["/api/migration/stats"],
  });

  // ---- Import (scraped JSON -> database) ----
  const [reimportAll, setReimportAll] = useState(false);

  const { data: manifest, refetch: refetchManifest } = useQuery<ImportManifest>({
    queryKey: ["/api/import/manifest"],
  });

  const { data: importStatus } = useQuery<ImportStatus>({
    queryKey: ["/api/import/status"],
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? 1500 : false,
  });

  const importRunning = importStatus?.status === "running";

  const startImportMutation = useMutation({
    mutationFn: async (full: boolean) => {
      const response = await apiRequest("POST", "/api/import/start", {
        reimportAll: full,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Import Started",
        description: "Walking scraped files into the database…",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/import/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error?.message || "Could not start the import",
        variant: "destructive",
      });
    },
  });

  // Refresh the manifest once a run finishes so "already imported" updates.
  useEffect(() => {
    if (importStatus?.status === "completed" || importStatus?.status === "error") {
      refetchManifest();
    }
  }, [importStatus?.status, refetchManifest]);

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/migration/test-connection", creds);
      return response.json();
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({
          title: "Connection Successful",
          description: data.message,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.message,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Connection Error",
        description: `Failed to test connection: ${error}`,
        variant: "destructive",
      });
    },
  });

  // Start migration mutation
  const startMigrationMutation = useMutation({
    mutationFn: async (creds: { username: string; password: string }) => {
      const response = await apiRequest("POST", "/api/migration/start", creds);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Migration Started",
        description: data.message,
      });
      refetchProgress();
      queryClient.invalidateQueries({ queryKey: ["/api/migration/stats"] });
    },
    onError: (error) => {
      toast({
        title: "Migration Failed",
        description: `Failed to start migration: ${error}`,
        variant: "destructive",
      });
    },
  });

  // Stop migration mutation
  const stopMigrationMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/migration/stop");
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Migration Stopped",
        description: data.message,
      });
      refetchProgress();
    },
    onError: (error) => {
      toast({
        title: "Stop Failed",
        description: `Failed to stop migration: ${error}`,
        variant: "destructive",
      });
    },
  });

  const handleTestConnection = () => {
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    testConnectionMutation.mutate(credentials);
  };

  const handleStartMigration = () => {
    if (!credentials.username || !credentials.password) {
      toast({
        title: "Missing Credentials",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    startMigrationMutation.mutate(credentials);
  };

  const handleStopMigration = () => {
    stopMigrationMutation.mutate();
  };

  const getProgressPercentage = () => {
    if (!progress || progress.totalStudents === 0) return 0;
    return Math.round((progress.processedStudents / progress.totalStudents) * 100);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">Data Migration</h1>
          <p className="text-muted-foreground">
            Import student data from the legacy DriveTraqr system
          </p>
        </div>
        <Badge className={progress?.inProgress ? "bg-gradient-to-r from-[#ECC462] to-amber-500 text-[#111111] shadow-md" : "bg-gray-100 text-gray-800"}>
          {progress?.inProgress ? "In Progress" : "Ready"}
        </Badge>
      </div>

      <Tabs defaultValue="import" className="space-y-6">
        <TabsList>
          <TabsTrigger value="import" data-testid="tab-import">
            <Database className="mr-2 h-4 w-4" />
            Import to Database
          </TabsTrigger>
          <TabsTrigger value="scrape" data-testid="tab-scrape">
            <Download className="mr-2 h-4 w-4" />
            Scrape Legacy Site
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scrape" className="space-y-6 mt-0">

      {/* Migration Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Students</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalMigratedStudents || 0}</div>
            <p className="text-xs text-muted-foreground">
              Students in database
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Migration Progress</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {progress?.processedStudents || 0}
              {progress?.totalStudents ? ` / ${progress.totalStudents}` : ''}
            </div>
            <p className="text-xs text-muted-foreground">
              {progress?.inProgress ? `Processing letter: ${progress.currentLetter}` : 'Not running'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Time Remaining</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {progress?.estimatedTimeRemaining || "Unknown"}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated completion
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      {progress?.inProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5" />
              Migration in Progress
            </CardTitle>
            <CardDescription>
              Currently processing students from the legacy system
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{getProgressPercentage()}%</span>
              </div>
              <Progress value={getProgressPercentage()} className="w-full" />
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <strong>Current Letter:</strong> {progress.currentLetter}
              </div>
              <div>
                <strong>Students Processed:</strong> {progress.processedStudents}
              </div>
            </div>

            <Button 
              onClick={handleStopMigration}
              variant="destructive"
              disabled={stopMigrationMutation.isPending}
              className="w-full"
            >
              <StopCircle className="mr-2 h-4 w-4" />
              Stop Migration
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connection Setup */}
      {!progress?.inProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Legacy System Connection
            </CardTitle>
            <CardDescription>
              Enter your DriveTraqr admin credentials to begin the migration process
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter admin username"
                  value={credentials.username}
                  onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type={showCredentials ? "text" : "password"}
                  placeholder="Enter admin password"
                  value={credentials.password}
                  onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="showPassword"
                checked={showCredentials}
                onChange={(e) => setShowCredentials(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="showPassword" className="text-sm">
                Show credentials
              </Label>
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button
                onClick={handleTestConnection}
                variant="outline"
                disabled={testConnectionMutation.isPending}
                className="flex-1"
              >
                <TestTube className="mr-2 h-4 w-4" />
                Test Connection
              </Button>
              
              <Button
                onClick={handleStartMigration}
                disabled={startMigrationMutation.isPending}
                className="flex-1 bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg hover:shadow-xl transition-all duration-200"
              >
                <Upload className="mr-2 h-4 w-4" />
                Start Migration
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Migration Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Migration Process</CardTitle>
          <CardDescription>
            How the data migration works
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                1
              </div>
              <div>
                <strong>Authentication:</strong> Connect to mortys.drivetraqr.ca using admin credentials
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                2
              </div>
              <div>
                <strong>Student Discovery:</strong> Search through alphabetical student listings (A-Z)
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                3
              </div>
              <div>
                <strong>Data Extraction:</strong> Scrape profiles, test results, payment history, and documents
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-gradient-to-r from-[#ECC462] to-amber-500 flex items-center justify-center text-sm font-medium text-[#111111] shadow-md">
                4
              </div>
              <div>
                <strong>Data Import:</strong> Create student records, contracts, evaluations, and notes
              </div>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              The migration process may take several hours to complete 100,000+ student records. 
              You can safely close this page - the process will continue running in the background.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Error Log */}
      {progress?.errors && progress.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Migration Errors ({progress.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {progress.errors.map((error, index) => (
                <div key={index} className="text-sm p-2 bg-destructive/10 rounded">
                  {error}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

        </TabsContent>

        <TabsContent value="import" className="space-y-6 mt-0">
          <ImportTab
            manifest={manifest}
            importStatus={importStatus}
            importRunning={importRunning}
            reimportAll={reimportAll}
            setReimportAll={setReimportAll}
            onRefresh={() => refetchManifest()}
            onStart={() => startImportMutation.mutate(reimportAll)}
            isStarting={startImportMutation.isPending}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CountBadge({ counts }: { counts?: EntityCounts }) {
  if (!counts) return null;
  return (
    <span className="text-xs text-muted-foreground">
      <span className="text-green-600 font-medium">+{counts.created}</span>
      {" / "}
      <span className="text-blue-600 font-medium">~{counts.updated}</span>
      {" / "}
      <span className="text-gray-500">skip {counts.skipped}</span>
    </span>
  );
}

function ImportTab({
  manifest,
  importStatus,
  importRunning,
  reimportAll,
  setReimportAll,
  onRefresh,
  onStart,
  isStarting,
}: {
  manifest?: ImportManifest;
  importStatus?: ImportStatus;
  importRunning: boolean;
  reimportAll: boolean;
  setReimportAll: (v: boolean) => void;
  onRefresh: () => void;
  onStart: () => void;
  isStarting: boolean;
}) {
  const pct =
    importStatus && importStatus.total > 0
      ? Math.round((importStatus.processed / importStatus.total) * 100)
      : 0;
  const s = importStatus?.summary;
  const noData = manifest && (!manifest.exists || manifest.total === 0);

  const summaryRows: { label: string; counts?: EntityCounts }[] = [
    { label: "Students", counts: s?.students },
    { label: "Contracts", counts: s?.contracts },
    { label: "Payments", counts: s?.transactions },
    { label: "Evaluations", counts: s?.evaluations },
    { label: "Lessons", counts: s?.lessons },
    { label: "Notes", counts: s?.notes },
    { label: "Screenshots", counts: s?.documents },
  ];

  // Run Import is hidden for now to avoid confusing users. Flip to true to
  // restore the import controls, progress, results, and live log.
  const SHOW_RUN_IMPORT = false;

  return (
    <div className="space-y-6">
      {/* Available files by type */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              Scraped Files Ready to Import
            </CardTitle>
            <CardDescription>
              Pages collected by the scraper, grouped by type
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            data-testid="button-refresh-manifest"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Folder:</span>
              <code className="text-xs bg-muted px-2 py-1 rounded" data-testid="text-data-dir">
                {manifest?.dataDir || "—"}
              </code>
            </div>
            <div>
              <span className="text-muted-foreground">Total files: </span>
              <strong data-testid="text-total-files">{manifest?.total ?? 0}</strong>
            </div>
            <div>
              <span className="text-muted-foreground">Already imported: </span>
              <strong data-testid="text-already-imported">
                {manifest?.alreadyImported ?? 0}
              </strong>
            </div>
          </div>

          {noData ? (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No scraped files were found in the data folder. Run the scraper
                first (see the “Scrape Legacy Site” tab), then refresh.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(manifest?.byType || {})
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => (
                  <div
                    key={type}
                    className="flex items-center justify-between rounded-lg border p-3"
                    data-testid={`card-pagetype-${type}`}
                  >
                    <span className="text-sm">
                      {PAGE_TYPE_LABELS[type] || type}
                    </span>
                    <Badge variant="secondary">{count}</Badge>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Run controls */}
      {SHOW_RUN_IMPORT && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Run Import
          </CardTitle>
          <CardDescription>
            Reads each scraped page and adds or updates records in the database.
            Safe to run again — unchanged pages are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="reimportAll"
              checked={reimportAll}
              onCheckedChange={(c) => setReimportAll(c === true)}
              disabled={importRunning}
              data-testid="checkbox-reimport-all"
            />
            <Label htmlFor="reimportAll" className="text-sm font-normal">
              Re-process every file (ignore the “unchanged” skip)
            </Label>
          </div>

          <Button
            onClick={onStart}
            disabled={importRunning || isStarting || noData}
            className="w-full bg-gradient-to-r from-[#ECC462] to-amber-500 hover:from-[#d4ad4f] hover:to-amber-600 text-[#111111] font-medium shadow-lg"
            data-testid="button-run-import"
          >
            {importRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              <>
                <PlayCircle className="mr-2 h-4 w-4" />
                Run Import
              </>
            )}
          </Button>

          {importStatus && importStatus.status !== "idle" && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  {importStatus.status === "running"
                    ? `Processing ${importStatus.processed} / ${importStatus.total}`
                    : importStatus.status === "completed"
                      ? "Completed"
                      : importStatus.status === "error"
                        ? "Stopped with an error"
                        : ""}
                </span>
                <span>{pct}%</span>
              </div>
              <Progress value={pct} className="w-full" />
              {importStatus.currentFile && importRunning && (
                <p className="text-xs text-muted-foreground truncate" data-testid="text-current-file">
                  {importStatus.currentFile}
                </p>
              )}
            </div>
          )}

          {importStatus?.error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription data-testid="text-import-error">
                {importStatus.error}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      )}

      {/* Summary */}
      {SHOW_RUN_IMPORT && s && (importStatus?.status === "completed" || importStatus?.status === "running") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              Results
            </CardTitle>
            <CardDescription>
              Created (+) / updated (~) / skipped per record type
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="flex flex-col gap-1 rounded-lg border p-3"
                  data-testid={`summary-${row.label.toLowerCase()}`}
                >
                  <span className="text-sm font-medium">{row.label}</span>
                  <CountBadge counts={row.counts} />
                </div>
              ))}
            </div>
            <Separator className="my-4" />
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                Pages processed:{" "}
                <strong data-testid="text-pages-processed">{s.pages.processed}</strong>
              </span>
              <span>
                Skipped (unchanged):{" "}
                <strong data-testid="text-pages-skipped">{s.pages.skipped}</strong>
              </span>
              <span className={s.pages.errors > 0 ? "text-destructive" : ""}>
                Errors: <strong data-testid="text-pages-errors">{s.pages.errors}</strong>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live log */}
      {SHOW_RUN_IMPORT && importStatus && importStatus.logs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Live Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="bg-[#111111] text-gray-100 rounded-md p-3 text-xs font-mono max-h-72 overflow-y-auto space-y-0.5"
              data-testid="container-import-log"
            >
              {importStatus.logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}