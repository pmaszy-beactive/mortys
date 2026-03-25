import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Send, Clock, Edit, X, BarChart3, Mail, Users, AlertTriangle, Search, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import MessageForm from "@/components/message-form";
import { formatDate, getStatusColor } from "@/lib/utils";
import type { Communication, Class } from "@shared/schema";

export default function Communications() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Communication | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: communications = [], isLoading } = useQuery<Communication[]>({
    queryKey: ["/api/communications"],
  });

  const { data: classes = [] } = useQuery<Class[]>({
    queryKey: ["/api/classes"],
  });

  const filteredMessages = useMemo(() => {
    let filtered = [...communications];
    
    if (activeTab !== "all") {
      filtered = filtered.filter(c => c.status === activeTab);
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(c => 
        c.subject?.toLowerCase().includes(query) ||
        c.message?.toLowerCase().includes(query) ||
        c.messageType?.toLowerCase().includes(query)
      );
    }
    
    return filtered.sort((a, b) => {
      const dateA = a.sendDate ? new Date(a.sendDate).getTime() : 0;
      const dateB = b.sendDate ? new Date(b.sendDate).getTime() : 0;
      return dateB - dateA;
    });
  }, [communications, activeTab, searchQuery]);

  const messageThreads = useMemo(() => {
    const threads: Record<string, Communication[]> = {};
    filteredMessages.forEach(msg => {
      const threadKey = msg.messageType || 'other';
      if (!threads[threadKey]) {
        threads[threadKey] = [];
      }
      threads[threadKey].push(msg);
    });
    return threads;
  }, [filteredMessages]);

  const toggleThread = (threadKey: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(threadKey)) {
        next.delete(threadKey);
      } else {
        next.add(threadKey);
      }
      return next;
    });
  };

  const cancelMessageMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PUT", `/api/communications/${id}`, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      toast({
        title: "Success",
        description: "Scheduled message cancelled",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to cancel message",
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PUT", `/api/communications/${id}`, { 
      status: "sent",
      sendDate: new Date().toISOString()
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
      toast({
        title: "Success",
        description: "Message sent successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const messageStats = {
    sentToday: communications.filter(c => 
      c.status === "sent" && 
      c.sendDate && 
      new Date(c.sendDate).toDateString() === new Date().toDateString()
    ).length,
    openRate: Math.round(
      communications.filter(c => c.status === "sent").length > 0 
        ? communications.filter(c => c.status === "sent").reduce((sum, c) => sum + (c.openRate || 0), 0) / 
          communications.filter(c => c.status === "sent").length 
        : 0
    ),
    scheduled: communications.filter(c => c.status === "scheduled").length,
    totalRecipients: communications.reduce((sum, c) => {
      if (Array.isArray(c.recipients)) {
        return sum + c.recipients.length;
      }
      return sum;
    }, 0),
  };

  const getMessageTypeIcon = (messageType: string) => {
    switch (messageType) {
      case "announcement": return <Mail className="text-[#ECC462] h-5 w-5" />;
      case "reminder": return <Clock className="text-green-600 h-5 w-5" />;
      case "schedule-change": return <AlertTriangle className="text-yellow-600 h-5 w-5" />;
      case "payment-notice": return <AlertTriangle className="text-orange-600 h-5 w-5" />;
      default: return <Mail className="text-gray-600 h-5 w-5" />;
    }
  };

  const getRecipientCount = (recipients: any) => {
    if (Array.isArray(recipients)) {
      return recipients.length;
    }
    return 0;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-gray-200 rounded-md w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 bg-white border border-gray-200 rounded-md"></div>
            ))}
          </div>
          <div className="h-96 bg-white border border-gray-200 rounded-md"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Communications
            </h1>
            <p className="text-gray-600">
              Send messages to students, instructors, and classes.
            </p>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#ECC462] hover:bg-[#d4ad4f] text-[#111111] font-medium rounded-md transition-all duration-200">
                <Send className="mr-2 h-4 w-4" />
                Compose Message
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Compose New Message</DialogTitle>
                <DialogDescription>
                  Send a message to students, instructors, or specific groups.
                </DialogDescription>
              </DialogHeader>
              <MessageForm onSuccess={() => setIsCreateDialogOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Sent Today</p>
                <p className="text-3xl font-bold text-gray-900">
                  {messageStats.sentToday}
                </p>
              </div>
              <Send className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Open Rate</p>
                <p className="text-3xl font-bold text-gray-900">
                  {messageStats.openRate}%
                </p>
              </div>
              <BarChart3 className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Scheduled</p>
                <p className="text-3xl font-bold text-gray-900">
                  {messageStats.scheduled}
                </p>
              </div>
              <Clock className="text-gray-400 h-6 w-6" />
            </div>
          </div>

          <div className="stat-card">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600 mb-1">Total Recipients</p>
                <p className="text-3xl font-bold text-gray-900">
                  {messageStats.totalRecipients}
                </p>
              </div>
              <Users className="text-gray-400 h-6 w-6" />
            </div>
          </div>
        </div>

        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="bg-gray-50/50 border-b border-gray-200">
            <CardTitle className="text-xl font-semibold text-gray-900">Send Quick Message</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <MessageForm onSuccess={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/communications"] });
              toast({
                title: "Success",
                description: "Message sent successfully",
              });
            }} />
          </CardContent>
        </Card>

        <Card className="bg-white border border-gray-200 rounded-md shadow-sm">
          <CardHeader className="bg-gray-50/50 border-b border-gray-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <CardTitle className="text-xl font-semibold text-gray-900">Message History</CardTitle>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search messages..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 border-gray-200 rounded-md"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
              <TabsList className="bg-gray-50 border border-gray-200 rounded-md p-1">
                <TabsTrigger value="all" className="rounded-md">
                  All ({communications.length})
                </TabsTrigger>
                <TabsTrigger value="sent" className="rounded-md">
                  Sent ({communications.filter(c => c.status === "sent").length})
                </TabsTrigger>
                <TabsTrigger value="scheduled" className="rounded-md">
                  Scheduled ({communications.filter(c => c.status === "scheduled").length})
                </TabsTrigger>
                <TabsTrigger value="draft" className="rounded-md">
                  Drafts ({communications.filter(c => c.status === "draft").length})
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {Object.keys(messageThreads).length > 0 && (
              <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
                <MessageSquare className="h-4 w-4" />
                <span>{filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''} found</span>
                {searchQuery && <span className="text-gray-900">matching "{searchQuery}"</span>}
              </div>
            )}

            <div className="space-y-6">
              {Object.entries(messageThreads).map(([threadKey, messages]) => (
                <div key={threadKey} className="border border-gray-200 rounded-md overflow-hidden">
                  <button
                    onClick={() => toggleThread(threadKey)}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {getMessageTypeIcon(threadKey)}
                      <span className="font-semibold text-gray-900 capitalize">{threadKey.replace('-', ' ')}</span>
                      <Badge variant="outline" className="ml-2 text-gray-600 border-gray-200">
                        {messages.length} message{messages.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    {expandedThreads.has(threadKey) ? (
                      <ChevronUp className="h-5 w-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-500" />
                    )}
                  </button>
                  
                  {expandedThreads.has(threadKey) && (
                    <div className="p-4 space-y-3 bg-white">
                      {messages.map((message) => (
                        <div 
                          key={message.id} 
                          className="flex items-start space-x-4 p-4 rounded-md border border-gray-100 hover:bg-gray-50 transition-all duration-200"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold text-gray-900">{message.subject}</h4>
                              <div className="flex items-center space-x-2">
                                <Badge variant="outline" className={`${getStatusColor(message.status)} border-current`}>
                                  {message.status.charAt(0).toUpperCase() + message.status.slice(1)}
                                </Badge>
                                <span className="text-xs text-gray-500">
                                  {message.sendDate ? formatDate(message.sendDate) : "Not sent"}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-gray-600">
                              Recipients: <span className="font-medium">{getRecipientCount(message.recipients)}</span>
                            </p>
                            {message.status === "sent" && (
                              <p className="text-xs text-gray-500 mt-2 flex items-center gap-2">
                                <BarChart3 className="h-3 w-3" />
                                {message.openRate || 0}% opened • {message.clickRate || 0}% clicked
                              </p>
                            )}
                          </div>
                          <div className="flex-shrink-0">
                            <div className="flex space-x-1">
                              {message.status === "draft" && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => sendMessageMutation.mutate(message.id)}
                                  className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 rounded-md"
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              )}
                              {message.status === "scheduled" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setEditingMessage(message)}
                                    className="h-8 w-8 p-0 text-[#111111] hover:bg-gray-100 rounded-md"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => cancelMessageMutation.mutate(message.id)}
                                    className="h-8 w-8 p-0 text-red-600 hover:bg-red-50 rounded-md"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {filteredMessages.length === 0 && (
                <div className="text-center py-12 text-gray-500 border border-dashed border-gray-200 rounded-md">
                  <div className="flex flex-col items-center gap-3">
                    <Mail className="h-12 w-12 text-gray-300" />
                    <p className="font-semibold text-gray-900">
                      {searchQuery ? "No messages match your search" : "No messages found"}
                    </p>
                    <p className="text-sm">
                      {searchQuery ? "Try a different search term" : "Compose your first message to get started."}
                    </p>
                    {searchQuery && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setSearchQuery("")}
                        className="mt-2 rounded-md"
                      >
                        Clear search
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {editingMessage && (
          <Dialog open={true} onOpenChange={() => setEditingMessage(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Edit Message</DialogTitle>
                <DialogDescription>
                  Update message content and settings.
                </DialogDescription>
              </DialogHeader>
              <MessageForm 
                message={editingMessage} 
                onSuccess={() => setEditingMessage(null)} 
              />
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
