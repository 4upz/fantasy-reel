-- Migration: Add account linking support
-- Adds functions needed for detecting duplicate accounts during OAuth

-- Function to count users with a given email
-- Used to detect duplicate accounts during OAuth signup
CREATE OR REPLACE FUNCTION count_users_by_email(email_to_check TEXT)
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM auth.users
  WHERE email = email_to_check;
$$;

-- Grant execute to authenticated users (needed for the callback route)
GRANT EXECUTE ON FUNCTION count_users_by_email(TEXT) TO authenticated;

-- Function to get the original user ID for a given email (excluding a specific user)
-- Used during the merge process
CREATE OR REPLACE FUNCTION get_original_user_id(email_to_check TEXT, exclude_user_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT id
  FROM auth.users
  WHERE email = email_to_check
    AND id != exclude_user_id
  ORDER BY created_at ASC
  LIMIT 1;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION get_original_user_id(TEXT, UUID) TO authenticated;

-- Function to transfer an identity from one user to another
-- Used during the account merge process
-- IMPORTANT: This should only be called from the merge-accounts edge function
CREATE OR REPLACE FUNCTION transfer_identity(
  from_user_id UUID,
  to_user_id UUID,
  provider_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
DECLARE
  identity_id UUID;
BEGIN
  -- Find the identity to transfer
  SELECT id INTO identity_id
  FROM auth.identities
  WHERE user_id = from_user_id
    AND provider = provider_name
  LIMIT 1;

  IF identity_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Update the identity to point to the new user
  UPDATE auth.identities
  SET user_id = to_user_id,
      updated_at = NOW()
  WHERE id = identity_id;

  RETURN TRUE;
END;
$$;

-- Only grant to service_role (called from edge function)
GRANT EXECUTE ON FUNCTION transfer_identity(UUID, UUID, TEXT) TO service_role;

-- Function to delete a user and their profile (for cleanup after merge)
-- IMPORTANT: This should only be called from the merge-accounts edge function
CREATE OR REPLACE FUNCTION delete_duplicate_user(duplicate_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  -- Delete the profile first (due to foreign key)
  DELETE FROM public.profiles WHERE user_id = duplicate_user_id;

  -- Delete any remaining identities
  DELETE FROM auth.identities WHERE user_id = duplicate_user_id;

  -- Delete the user
  DELETE FROM auth.users WHERE id = duplicate_user_id;

  RETURN TRUE;
EXCEPTION
  WHEN OTHERS THEN
    RETURN FALSE;
END;
$$;

-- Only grant to service_role (called from edge function)
GRANT EXECUTE ON FUNCTION delete_duplicate_user(UUID) TO service_role;
