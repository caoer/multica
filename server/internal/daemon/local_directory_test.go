package daemon

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestFindLocalDirectoryAssignment(t *testing.T) {
	const thisDaemon = "d-mine"
	otherDaemon := "d-other"

	mkRef := func(t *testing.T, ref localDirectoryRef) json.RawMessage {
		t.Helper()
		raw, err := json.Marshal(ref)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return raw
	}

	tmp := t.TempDir()

	t.Run("no resources returns nil", func(t *testing.T) {
		got, err := findLocalDirectoryAssignment(nil, thisDaemon)
		if err != nil || got != nil {
			t.Fatalf("expected (nil, nil), got (%+v, %v)", got, err)
		}
	})

	t.Run("other daemon is skipped", func(t *testing.T) {
		got, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: localDirectoryResourceType, ResourceRef: mkRef(t, localDirectoryRef{LocalPath: tmp, DaemonID: otherDaemon})},
		}, thisDaemon)
		if err != nil || got != nil {
			t.Fatalf("expected (nil, nil), got (%+v, %v)", got, err)
		}
	})

	t.Run("non-matching type is skipped", func(t *testing.T) {
		got, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: "github_repo", ResourceRef: json.RawMessage(`{"url":"https://x"}`)},
		}, thisDaemon)
		if err != nil || got != nil {
			t.Fatalf("expected (nil, nil), got (%+v, %v)", got, err)
		}
	})

	t.Run("matching daemon returns assignment", func(t *testing.T) {
		got, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: localDirectoryResourceType, ResourceRef: mkRef(t, localDirectoryRef{LocalPath: tmp, DaemonID: thisDaemon})},
		}, thisDaemon)
		if err != nil {
			t.Fatalf("err: %v", err)
		}
		if got == nil {
			t.Fatalf("expected assignment, got nil")
		}
		if got.AbsPath != filepath.Clean(tmp) {
			t.Errorf("AbsPath = %q, want %q", got.AbsPath, filepath.Clean(tmp))
		}
		if got.RealPath == "" {
			t.Errorf("RealPath empty")
		}
	})

	t.Run("missing daemon_id is rejected", func(t *testing.T) {
		_, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: localDirectoryResourceType, ResourceRef: mkRef(t, localDirectoryRef{LocalPath: tmp})},
		}, thisDaemon)
		if err == nil {
			t.Fatalf("expected error for missing daemon_id")
		}
	})

	t.Run("relative path is rejected", func(t *testing.T) {
		_, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: localDirectoryResourceType, ResourceRef: mkRef(t, localDirectoryRef{LocalPath: "relative/path", DaemonID: thisDaemon})},
		}, thisDaemon)
		if err == nil {
			t.Fatalf("expected error for relative path")
		}
	})

	t.Run("malformed ref json fails", func(t *testing.T) {
		_, err := findLocalDirectoryAssignment([]ProjectResourceData{
			{ID: "r1", ResourceType: localDirectoryResourceType, ResourceRef: json.RawMessage(`{not json`)},
		}, thisDaemon)
		if err == nil {
			t.Fatalf("expected error for malformed json")
		}
	})
}

func TestValidateLocalPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("blacklist constants are POSIX-only in this test")
	}

	dir := t.TempDir()

	t.Run("accepts a writable directory", func(t *testing.T) {
		if err := validateLocalPath(dir); err != nil {
			t.Errorf("unexpected: %v", err)
		}
	})

	t.Run("rejects relative path", func(t *testing.T) {
		if err := validateLocalPath("relative"); err == nil {
			t.Errorf("expected error")
		}
	})

	t.Run("rejects empty path", func(t *testing.T) {
		if err := validateLocalPath(""); err == nil {
			t.Errorf("expected error")
		}
	})

	t.Run("rejects system roots", func(t *testing.T) {
		for _, banned := range []string{"/", "/Users", "/home"} {
			if err := validateLocalPath(banned); err == nil {
				t.Errorf("expected error for %q", banned)
			}
		}
	})

	t.Run("rejects the user home directory", func(t *testing.T) {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			t.Skip("no home dir")
		}
		if err := validateLocalPath(home); err == nil {
			t.Errorf("expected error for $HOME")
		}
	})

	t.Run("rejects missing path", func(t *testing.T) {
		missing := filepath.Join(dir, "does-not-exist")
		if err := validateLocalPath(missing); err == nil {
			t.Errorf("expected error")
		}
	})

	t.Run("rejects a regular file", func(t *testing.T) {
		f := filepath.Join(dir, "afile")
		if err := os.WriteFile(f, []byte("hi"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := validateLocalPath(f); err == nil {
			t.Errorf("expected error")
		}
	})

	t.Run("rejects an unwritable directory", func(t *testing.T) {
		// chmod-based unwritable is unreliable as root; skip when uid==0.
		if os.Getuid() == 0 {
			t.Skip("test cannot run as root; chmod is a no-op")
		}
		ro := filepath.Join(dir, "ro")
		if err := os.Mkdir(ro, 0o555); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		t.Cleanup(func() { _ = os.Chmod(ro, 0o755) })
		if err := validateLocalPath(ro); err == nil {
			t.Errorf("expected error for read-only directory")
		}
	})
}

func TestLocalPathLockerSerializes(t *testing.T) {
	locker := NewLocalPathLocker()
	const path = "/some/path"

	rel1, err := locker.Acquire(context.Background(), path, "task-1", nil)
	if err != nil {
		t.Fatalf("acquire 1: %v", err)
	}
	if got := locker.Holder(path); got != "task-1" {
		t.Errorf("holder = %q, want task-1", got)
	}

	// task-2 must wait, with onWait fired and the holder reported.
	var waitCalls atomic.Int32
	var sawHolder atomic.Value
	done := make(chan error, 1)
	go func() {
		rel, err := locker.Acquire(context.Background(), path, "task-2", func(holder string) {
			waitCalls.Add(1)
			sawHolder.Store(holder)
		})
		if err != nil {
			done <- err
			return
		}
		if got := locker.Holder(path); got != "task-2" {
			done <- errorsNew("holder after handover = " + got)
			return
		}
		rel()
		done <- nil
	}()

	// give the goroutine time to enter the wait
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) && waitCalls.Load() == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	if waitCalls.Load() != 1 {
		t.Fatalf("onWait calls = %d, want 1", waitCalls.Load())
	}
	if got := sawHolder.Load(); got != "task-1" {
		t.Errorf("onWait holder = %v, want task-1", got)
	}

	rel1()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("waiter result: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("waiter never woke")
	}
	if got := locker.Holder(path); got != "" {
		t.Errorf("holder after release = %q, want empty", got)
	}
}

func TestLocalPathLockerCtxCancel(t *testing.T) {
	locker := NewLocalPathLocker()
	const path = "/some/path"

	rel1, err := locker.Acquire(context.Background(), path, "task-1", nil)
	if err != nil {
		t.Fatalf("acquire 1: %v", err)
	}
	defer rel1()

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err = locker.Acquire(ctx, path, "task-2", nil)
	if err == nil {
		t.Fatalf("expected ctx error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want DeadlineExceeded", err)
	}
}

func TestLocalPathLockerDistinctPathsParallel(t *testing.T) {
	locker := NewLocalPathLocker()

	rel1, err := locker.Acquire(context.Background(), "/a", "task-1", nil)
	if err != nil {
		t.Fatalf("acquire 1: %v", err)
	}
	defer rel1()

	// Different path must not block.
	done := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		rel2, err := locker.Acquire(context.Background(), "/b", "task-2", nil)
		if err != nil {
			t.Errorf("acquire 2: %v", err)
			return
		}
		rel2()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("acquire on distinct path blocked")
	}
	wg.Wait()
}

// errorsNew is a tiny helper so the goroutine above can return a typed error
// without importing errors / fmt at the call site.
func errorsNew(msg string) error { return &waiterError{msg: msg} }

type waiterError struct{ msg string }

func (e *waiterError) Error() string { return e.msg }
