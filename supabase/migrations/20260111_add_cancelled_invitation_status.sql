-- Add 'cancelled' status to invitations table for league owners to cancel sent invitations

ALTER TABLE invitations
DROP CONSTRAINT invitations_status_check;

ALTER TABLE invitations
ADD CONSTRAINT invitations_status_check
CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'));
