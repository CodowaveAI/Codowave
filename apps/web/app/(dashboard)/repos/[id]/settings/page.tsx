'use client';

import { useState, useEffect } from 'react';

interface Repository {
  id: string;
  name: string;
  fullName: string;
  autopilotEnabled: boolean;
  enabled: boolean;
}

interface SettingsPageProps {
  params: Promise<{ id: string }>;
}

export default function RepositorySettingsPage({ params }: SettingsPageProps) {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoId, setRepoId] = useState<string>('');

  useEffect(() => {
    params.then((resolvedParams) => {
      setRepoId(resolvedParams.id);
      fetchRepositorySettings(resolvedParams.id);
    });
  }, [params]);

  async function fetchRepositorySettings(id: string) {
    try {
      setLoading(true);
      const response = await fetch(`/api/repos/${id}/settings`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch repository settings');
      }
      
      setRepository(data.repository);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }

  async function handleAutopilotToggle() {
    if (!repository || !repoId) return;
    
    try {
      setSaving(true);
      setError(null);
      
      const newAutopilotState = !repository.autopilotEnabled;
      
      const response = await fetch(`/api/repos/${repoId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          autopilotEnabled: newAutopilotState,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update autopilot setting');
      }
      
      setRepository(data.repository);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (error && !repository) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold mb-2">
        {repository?.fullName || 'Repository'} Settings
      </h1>
      <p className="text-gray-600 mb-8">
        Manage your repository settings for Codowave
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white border rounded-lg shadow-sm">
        <div className="p-6 border-b">
          <h2 className="text-lg font-semibold">Autopilot</h2>
          <p className="text-sm text-gray-600 mt-1">
            When enabled, Codowave will automatically pick up and work on issues
            labeled with &quot;agent-ready&quot;
          </p>
        </div>
        
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Enable Autopilot</h3>
              <p className="text-sm text-gray-500">
                {repository?.autopilotEnabled 
                  ? 'Autopilot is currently active for this repository'
                  : 'Autopilot is currently disabled for this repository'
                }
              </p>
            </div>
            
            <button
              onClick={handleAutopilotToggle}
              disabled={saving}
              className={`
                relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                ${repository?.autopilotEnabled ? 'bg-blue-600' : 'bg-gray-200'}
                ${saving ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              role="switch"
              aria-checked={repository?.autopilotEnabled}
            >
              <span
                className={`
                  inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                  ${repository?.autopilotEnabled ? 'translate-x-6' : 'translate-x-1'}
                `}
              />
            </button>
          </div>
          
          {saving && (
            <p className="text-sm text-gray-500 mt-3">Saving changes...</p>
          )}
        </div>
      </div>

      <div className="mt-6 bg-gray-50 border rounded-lg p-4">
        <h3 className="font-medium text-sm text-gray-700">About Autopilot</h3>
        <p className="text-sm text-gray-500 mt-1">
          Autopilot automatically selects the highest priority issue, generates a fix,
          runs tests, and merges the PR when all checks pass. No approval required.
        </p>
      </div>
    </div>
  );
}
