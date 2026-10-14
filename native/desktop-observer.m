#import <AppKit/AppKit.h>
#include <signal.h>
#include <unistd.h>

static void emit(const char *line) { puts(line); fflush(stdout); }
static BOOL suspended = NO;
static void refresh(void) {
  NSString *bundle = NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier ?: @"";
  NSString *name = NSWorkspace.sharedWorkspace.frontmostApplication.localizedName ?: @"";
  BOOL secure = suspended || [bundle containsString:@"loginwindow"]
    || [bundle containsString:@"SecurityAgent"] || [bundle containsString:@"coreauth"]
    || [bundle containsString:@"CoreAuthentication"] || [bundle containsString:@"authorizationhost"]
    || [name isEqualToString:@"SecurityAgent"];
  emit(secure ? "BLOCK" : "UNBLOCK");
  if (!secure) emit("REFRESH");
}
int main(int argc, char **argv) {
  @autoreleasepool {
    signal(SIGPIPE, SIG_DFL);
    pid_t parent = argc > 1 ? (pid_t)atoi(argv[1]) : getppid();
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    NSNotificationCenter *center = NSWorkspace.sharedWorkspace.notificationCenter;
    for (NSString *name in @[NSWorkspaceDidActivateApplicationNotification, NSWorkspaceActiveSpaceDidChangeNotification]) {
      [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { refresh(); }];
    }
    for (NSString *name in @[NSWorkspaceSessionDidResignActiveNotification, NSWorkspaceWillSleepNotification]) {
      [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { suspended = YES; refresh(); }];
    }
    for (NSString *name in @[NSWorkspaceSessionDidBecomeActiveNotification, NSWorkspaceDidWakeNotification]) {
      [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { suspended = NO; refresh(); }];
    }
    dispatch_source_t input = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(input, ^{ char buffer[64]; if (read(STDIN_FILENO, buffer, sizeof(buffer)) <= 0) exit(0); });
    dispatch_resume(input);
    [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) { if (kill(parent, 0) != 0) exit(0); }];
    refresh();
    [NSApp run];
  }
  return 0;
}
