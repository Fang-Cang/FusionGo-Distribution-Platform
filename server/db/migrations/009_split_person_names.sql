ALTER TABLE user_profiles ADD COLUMN surname TEXT;
ALTER TABLE user_profiles ADD COLUMN given_name TEXT;

ALTER TABLE customers ADD COLUMN contact_surname TEXT;
ALTER TABLE customers ADD COLUMN contact_given_name TEXT;
