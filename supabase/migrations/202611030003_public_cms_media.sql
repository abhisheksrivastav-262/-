-- Content published by admins appears on the public site. Uploaded media is
-- public only because this bucket is exclusively for intentionally published
-- website photos; identity documents must use a separate private bucket.
alter table public.projects add column published boolean not null default false;
alter table public.projects add column image_path text;
alter table public.news add column image_path text;
alter table public.events add column image_path text;
alter table public.photo_albums add column cover_path text;
alter table public.gallery_images add column archived boolean not null default false;
alter table public.gallery_images add column created_at timestamptz not null default now();
alter table public.projects add column archived boolean not null default false;
alter table public.news add column archived boolean not null default false;
alter table public.events add column archived boolean not null default false;
alter table public.photo_albums add column archived boolean not null default false;
alter table public.videos add column archived boolean not null default false;
alter table public.videos add column created_at timestamptz not null default now();
alter table public.homepage_slides add column archived boolean not null default false;
alter table public.awards add column archived boolean not null default false;
alter table public.awards add column created_at timestamptz not null default now();
alter table public.annual_audit_reports add column archived boolean not null default false;
alter table public.management_team add column archived boolean not null default false;
alter table public.management_team add column created_at timestamptz not null default now();
alter table public.homepage_slides add column created_at timestamptz not null default now();

create policy public_projects_read on public.projects for select to anon,authenticated using(published and not archived);
create policy public_news_read on public.news for select to anon,authenticated using(published and not archived);
create policy public_events_read on public.events for select to anon,authenticated using(published and not archived);
create policy public_albums_read on public.photo_albums for select to anon,authenticated using(published and not archived);
create policy public_gallery_images_read on public.gallery_images for select to anon,authenticated using(not archived and exists(select 1 from public.photo_albums a where a.id=album_id and a.published and not a.archived));
create policy public_videos_read on public.videos for select to anon,authenticated using(published and not archived);
create policy public_awards_read on public.awards for select to anon,authenticated using(published and not archived);
create policy public_reports_read on public.annual_audit_reports for select to anon,authenticated using(published and not archived);
create policy public_team_read on public.management_team for select to anon,authenticated using(published and not archived);

create policy admin_projects_manage on public.projects for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_news_manage on public.news for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_events_manage on public.events for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_albums_manage on public.photo_albums for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_images_manage on public.gallery_images for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_videos_manage on public.videos for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_awards_manage on public.awards for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_reports_manage on public.annual_audit_reports for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_team_manage on public.management_team for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));
create policy public_units_read on public.organizational_units for select to anon,authenticated using(active);
create policy admin_units_manage on public.organizational_units for all to authenticated using(public.has_role(array['super_admin','admin']::public.app_role[])) with check(public.has_role(array['super_admin','admin']::public.app_role[]));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('public-media','public-media',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy public_media_read on storage.objects for select to anon,authenticated using(bucket_id='public-media');
create policy admin_public_media_upload on storage.objects for insert to authenticated with check(bucket_id='public-media' and public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_public_media_update on storage.objects for update to authenticated using(bucket_id='public-media' and public.has_role(array['super_admin','admin']::public.app_role[])) with check(bucket_id='public-media' and public.has_role(array['super_admin','admin']::public.app_role[]));
create policy admin_public_media_delete on storage.objects for delete to authenticated using(bucket_id='public-media' and public.has_role(array['super_admin','admin']::public.app_role[]));
