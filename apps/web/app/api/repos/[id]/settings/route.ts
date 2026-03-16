import { NextRequest, NextResponse } from 'next/server';
import { db } from '@codowave/core/db';
import { repositories } from '@codowave/core/db/schema';
import { eq } from 'drizzle-orm';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid repository ID format' },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { autopilotEnabled } = body;

    // Validate the request body
    if (typeof autopilotEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'autopilotEnabled must be a boolean' },
        { status: 400 }
      );
    }

    // Update the repository's autopilot_enabled setting
    const result = await db
      .update(repositories)
      .set({ 
        autopilotEnabled,
        updatedAt: new Date()
      })
      .where(eq(repositories.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      repository: result[0] 
    });
  } catch (error) {
    console.error('Error updating repository settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return NextResponse.json(
        { error: 'Invalid repository ID format' },
        { status: 400 }
      );
    }

    const result = await db
      .select({
        id: repositories.id,
        name: repositories.name,
        fullName: repositories.fullName,
        autopilotEnabled: repositories.autopilotEnabled,
        enabled: repositories.enabled,
      })
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Repository not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ repository: result[0] });
  } catch (error) {
    console.error('Error fetching repository settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
