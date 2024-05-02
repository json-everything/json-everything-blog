@echo off
del /s /q _site >nul
@echo on

bundle exec jekyll serve --incremental
