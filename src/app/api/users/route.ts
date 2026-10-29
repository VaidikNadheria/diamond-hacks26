import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { supabase } from '@/lib/supabase';
import { generateToken } from '@/lib/tokens';
import { RegisterSchema } from '@/lib/validators';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const { email, password } = parsed.data;
    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (lookupError) {
      console.error('Failed to look up user:', lookupError);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    // Legacy accounts also require verified recovery before setting a password.
    // Knowing an email address alone must never grant access to its alerts.
    if (existing) {
      return NextResponse.json(
        { error: 'Account already exists. Please sign in instead.' },
        { status: 409 }
      );
    }

    const password_hash = await hash(password, 10);
    const master_token = generateToken();
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ email, password_hash, master_token })
      .select('master_token')
      .single();

    // The unique email constraint also covers simultaneous registration requests.
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'Account already exists. Please sign in instead.' },
        { status: 409 }
      );
    }

    if (error || !newUser) {
      console.error('Failed to create user:', error);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    return NextResponse.json({
      exists: false,
      master_token: newUser.master_token,
      message: 'Account created successfully',
    }, { status: 201 });
  } catch (e) {
    console.error('/api/users error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
