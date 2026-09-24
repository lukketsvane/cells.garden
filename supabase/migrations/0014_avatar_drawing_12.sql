-- cells.garden: 12 by 12 drawn profile pictures, beside the 7 by 7 ones. Safe to run more than once.
--
-- Being tried out on dev.cells.garden: pictures of 12 by 12 pixels in a new
-- palette (PICTURE_GRID and PALETTE_12 in src/core/avatar-pixels.ts). Such a
-- drawing is "d2:" (version 2), one hex digit for the background (1-f), then
-- 144 hex digits for the grid, row by row (0 is an empty pixel): 148
-- characters. Every digit is still an index into a fixed palette of the app's,
-- never a colour of its own, so the stored text never reaches the picture's
-- markup. The 7 by 7 format of 0011 stays exactly as it was, so every drawing
-- already saved stays valid.
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
           or (length(avatar_drawing) = 148 and avatar_drawing ~ '^d2:[1-9a-f][0-9a-f]{144}$'));
