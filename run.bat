@echo off
del /s /q _site >nul

if "%1" == "prod" (
  set JEKYLL_ENV=production
  echo running prod
) else (
  set JEKYLL_ENV=
)
@echo on

bundle exec jekyll serve --incremental --livereload

