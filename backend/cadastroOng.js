const express = require('express');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

// --- Funções de Validação ---
const validarSenhaForte = (senha) => {
  const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;
  return regex.test(senha);
};

const validarCNPJ = (cnpj) => {
  if (!cnpj) return false;
  const justNums = cnpj.replace(/\D/g, '');
  // CNPJ deve ter 14 dígitos numéricos
  return /^\d{14}$/.test(justNums);
};

// --- Rota de Criação de ONG ---
router.post('/create', async (req, res) => {
  console.log('Recebido para cadastro de ONG:', req.body);

  try {
    const { nome, email, senha, cnpj, telefone, descricao, endereco } = req.body;

    // 1. Validação robusta dos dados de entrada
    if (!nome || !email || !senha || !cnpj || !endereco) {
      return res.status(400).json({ error: 'Campos obrigatórios (nome, email, senha, cnpj, endereço) não foram preenchidos.' });
    }
    if (!validarSenhaForte(senha)) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 8 caracteres, incluindo maiúsculas, minúsculas, números e caracteres especiais.' });
    }
    if (!validarCNPJ(cnpj)) {
      return res.status(400).json({ error: 'CNPJ inválido. Forneça 14 dígitos numéricos.' });
    }
    if (!endereco.cep || !endereco.logradouro || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.estado) {
        return res.status(400).json({ error: 'Endereço da ONG incompleto. Todos os campos são obrigatórios.' });
    }

    // 2. Verifica se o email (na tabela Usuario) ou CNPJ (na tabela Ong) já existem
    const [emailExistente, cnpjExistente] = await Promise.all([
      prisma.usuario.findUnique({ where: { email } }),
      prisma.ong.findUnique({ where: { cnpj } }),
    ]);

    if (emailExistente) {
      return res.status(409).json({ error: 'Este email já está em uso por outro usuário.' });
    }
    if (cnpjExistente) {
      return res.status(409).json({ error: 'Este CNPJ já está cadastrado.' });
    }

    // 3. Hashear a senha
    const hashedSenha = await bcrypt.hash(senha, 10);

    // 4. Criar Endereço, Usuário e ONG em uma única transação para garantir consistência
    const novaOngCompleta = await prisma.$transaction(async (tx) => {
      // Passo A: Cria o endereço
      const novoEndereco = await tx.endereco.create({
        data: {
          cep: endereco.cep,
          logradouro: endereco.logradouro,
          numero: endereco.numero,
          complemento: endereco.complemento,
          bairro: endereco.bairro,
          cidade: endereco.cidade,
          estado: endereco.estado,
        },
      });

      // Passo B: Cria o usuário que gerenciará a ONG
      const novoUsuarioGestor = await tx.usuario.create({
        data: {
          nome: nome, 
          email,
          cpf: cnpj, 
          senha: hashedSenha,
          role: 'ONG',
          idEndereco: novoEndereco.id, 
        },
      });

      
      const novaOng = await tx.ong.create({
        data: {
          nome,
          cnpj,
          telefone: telefone || null,
          descricao: descricao || null,
          status: 'pendente',
          idEndereco: novoEndereco.id, 
          // Conecta a ONG ao usuário que a gerencia
          gerente: {
            connect: { id: novoUsuarioGestor.id },
          },
        },
        include: {
          gerente: true, 
          endereco: true, 
        }
      });

      return novaOng;
    });

    delete novaOngCompleta.gerente.senha;

    return res.status(201).json({
      success: true,
      message: 'ONG cadastrada com sucesso! Aguardando verificação do administrador.',
      data: novaOngCompleta,
    });

  } catch (error) {
    console.error('Erro detalhado no cadastro de ONG:', error);
    if (error.code === 'P2002') {
      const field = error.meta?.target?.join(', ');
      return res.status(409).json({ error: `O campo '${field}' já está em uso.` });
    }

    return res.status(500).json({
      error: 'Ocorreu um erro interno no servidor. Por favor, tente novamente.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;