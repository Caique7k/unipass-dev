-- Desativar um aluno passou a liberar a TAG dele para outro aluno. Alunos
-- desativados antes desta regra ficaram com a TAG ativa; aplica o mesmo
-- estado. O vínculo (studentId) é mantido para o histórico.
UPDATE "RfidCard" AS c
SET "active" = false
FROM "Student" AS s
WHERE s."id" = c."studentId"
  AND s."active" = false
  AND c."active" = true;
