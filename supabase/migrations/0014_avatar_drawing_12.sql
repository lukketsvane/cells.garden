-- cells.garden: 12 by 12 drawn profile pictures, beside the 7 by 7 ones. Safe to run more than once.
--
-- Being tried out on dev.cells.garden: pictures of 12 by 12 pixels in the
-- avatar palette (PICTURE_GRID and PALETTE_12 in src/core/avatar-pixels.ts).
-- Such a drawing is "d2:" (version 2), one hex digit for the background, then
-- 144 hex digits for the grid, row by row: 148 characters. That palette has
-- sixteen colours and no empty slot, so every digit (0-f) is a colour, and a
-- pixel with nothing on it is one in the background's. Every digit is still an
-- index into a fixed palette of the app's, never a colour of its own, so the
-- stored text never reaches the picture's markup. The 7 by 7 format of 0011
-- stays exactly as it was, so every drawing already saved stays valid.
--
-- Who sees it and who may change it does not change (0011). A client from
-- before this migration shows a picture generated from a version 2 drawing's
-- text instead of the drawing, as one from before drawings did with version 1.
--
-- The check must say exactly what DRAWING_FORMAT and DRAWING_FORMAT_12 say, and
-- nothing looser (scripts/test-security.mjs compares them).

alter table public.profiles drop constraint if exists profiles_avatar_drawing_format;
alter table public.profiles add constraint profiles_avatar_drawing_format
    check (avatar_drawing is null
           or (length(avatar_drawing) = 53 and avatar_drawing ~ '^d1:[1-9a-f][0-9a-f]{49}$')
           or (length(avatar_drawing) = 148 and avatar_drawing ~ '^d2:[0-9a-f]{145}$'));
