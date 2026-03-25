import ZoomSettings from "@/components/zoom-settings";

export default function ZoomIntegrationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-[#111111] to-gray-800 bg-clip-text text-transparent">Zoom Integration</h1>
        <p className="text-muted-foreground">
          Configure Zoom settings for automated attendance tracking in theory classes.
        </p>
      </div>
      <ZoomSettings />
    </div>
  );
}