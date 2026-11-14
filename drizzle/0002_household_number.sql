-- Existing participant IDs, card bindings and NFC tokens remain unchanged.
-- Historical records are deliberately left unnumbered; names are not identities.
ALTER TABLE participants ADD COLUMN household_number INTEGER CHECK (household_number IS NULL OR (typeof(household_number) = 'integer' AND household_number > 0 AND house <> ''));
CREATE UNIQUE INDEX participants_household_number_unique ON participants (house, household_number) WHERE household_number IS NOT NULL;
