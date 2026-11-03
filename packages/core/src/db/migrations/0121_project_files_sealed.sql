-- Os arquivos de projeto passam a ficar cifrados: o nome na pasta é o hash, sem a extensão.
UPDATE project_files SET stored_name = content_hash || '.sek';
