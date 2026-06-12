import { useState, useEffect, useCallback } from 'react';

// Session/agent discovery, port scanning, per-project profiles, and Ollama
// availability — everything App polls from the main process on a 30s cadence.
export default function useSessions() {
  const [sessions, setSessions] = useState([]);
  const [activePorts, setActivePorts] = useState([]);
  const [profilesByPath, setProfilesByPath] = useState({});
  const [ollamaStatus, setOllamaStatus] = useState(false);

  // Discover sessions on mount and periodically
  const refreshSessions = useCallback(async () => {
    try {
      const discovered = await window.nockTerminal.sessions.discover();
      setSessions(discovered);
    } catch (err) {
      console.error('Session discovery failed:', err);
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const ports = await window.nockTerminal.ports.scan();
      setActivePorts(ports);
    } catch (err) {
      console.error('Port scan failed:', err);
    }
  }, []);

  useEffect(() => {
    refreshSessions();
    refreshPorts();
    const interval = setInterval(() => {
      refreshSessions();
      refreshPorts();
    }, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [refreshSessions, refreshPorts]);

  useEffect(() => {
    let cancelled = false;
    const paths = [...new Set(sessions.map(session => session.path).filter(Boolean))];
    if (paths.length === 0) {
      setProfilesByPath({});
      return undefined;
    }

    Promise.all(paths.map(async (projectPath) => {
      try {
        const profile = await window.nockTerminal.profiles.get(projectPath);
        return [projectPath, profile || {}];
      } catch {
        return [projectPath, {}];
      }
    })).then((entries) => {
      if (!cancelled) {
        setProfilesByPath(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [sessions]);

  // Poll Ollama status every 30s
  useEffect(() => {
    const checkOllama = async () => {
      try {
        const result = await window.nockTerminal.ai.ollama.status();
        setOllamaStatus(result?.connected === true);
      } catch {
        setOllamaStatus(false);
      }
    };
    checkOllama();
    const interval = setInterval(checkOllama, 30000);
    return () => clearInterval(interval);
  }, []);

  const getProfileForPath = useCallback(async (projectPath) => {
    if (!projectPath) return {};
    if (profilesByPath[projectPath]) return profilesByPath[projectPath];
    try {
      return await window.nockTerminal.profiles.get(projectPath);
    } catch {
      return {};
    }
  }, [profilesByPath]);

  return {
    sessions,
    refreshSessions,
    activePorts,
    profilesByPath,
    getProfileForPath,
    ollamaStatus,
  };
}
